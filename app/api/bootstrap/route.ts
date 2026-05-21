import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import type { AppSession } from "@/app/lib/auth/session";
import { normalizeStatus } from "@/app/lib/calculations";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const DEFAULT_RECEIPT_LIMIT = 15;
const MAX_RECEIPT_LIMIT = 30;
const EMPLOYEE_PROFILE_SELECT = "id, display_name, employee_no, email, department_id, active, created_at, updated_at, departments!profiles_department_id_fkey(name)";
const EMPLOYEE_RECEIPT_SELECT = "id, receipt_date, payer_profile_id, submitted_by, department_id, merchant, receipt_no, total_amount, claimed_amount, subsidy_amount, reimbursed_amount, status, note, metadata, created_at, updated_at";
const EMPLOYEE_CLAIM_SELECT = "id, receipt_id, claim_date, profile_id, claimed_amount, note, created_at, updated_at";
const EMPLOYEE_ATTACHMENT_SELECT = "id, receipt_id, bucket, object_path, content_type, size_bytes, created_at";

export async function GET(request: Request) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "initial";
  const offset = clampOffset(url.searchParams.get("offset"));
  const limit = clampLimit(url.searchParams.get("limit"));
  const currentProfileId = guard.session!.profileId;
  const supabase = createSupabaseAdminClient();

  // ── 1. Fetch current user's profile (single row) ──────────────────────────
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select(EMPLOYEE_PROFILE_SELECT)
    .eq("id", currentProfileId)
    .single();

  if (profileError || !profileData) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  const profile = profileData as any;

  const currentEmployee = {
    employee_id: profile.id,
    name: profile.display_name,
    active: profile.active,
    note: [profile.employee_no, profile.email].filter(Boolean).join(" / "),
    department_id: profile.department_id,
    department_name: profile.departments?.name ?? null,
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };

  if (mode === "directory") {
    const directory = await loadAllowedDirectory(supabase, guard.session!, currentEmployee);
    return NextResponse.json({
      employees: [currentEmployee],
      allowedClaimants: directory.allowedClaimants,
      departments: directory.allowedDepartments,
      receipts: [],
      allocations: [],
      attachments: []
    });
  }

  // ── 2. Fetch only the current page of this user's receipts ────────────────
  const { data: receiptsRaw, error: receiptsError } = await supabase
    .from("receipts")
    .select(EMPLOYEE_RECEIPT_SELECT)
    .or(`submitted_by.eq.${currentProfileId},payer_profile_id.eq.${currentProfileId}`)
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (receiptsError) return NextResponse.json({ error: receiptsError.message }, { status: 500 });

  const hasMore = (receiptsRaw ?? []).length > limit;
  const visibleReceiptsRaw = (receiptsRaw ?? []).slice(0, limit);
  const receipts = visibleReceiptsRaw.map((r: any) => ({
    receipt_id: r.id,
    date: r.receipt_date,
    payer_employee_id: r.payer_profile_id ?? r.submitted_by,
    submitted_by: r.submitted_by,
    department_id: r.department_id,
    applicant_name: r.metadata?.applicant_name,
    claimant_names: Array.isArray(r.metadata?.claimant_names) ? r.metadata.claimant_names : [],
    claimant_ids: Array.isArray(r.metadata?.claimant_ids) ? r.metadata.claimant_ids : [],
    merchant: r.merchant ?? "",
    total_amount: Number(r.total_amount ?? 0),
    claimed_amount: Number(r.claimed_amount ?? 0),
    subsidy_amount: Number(r.subsidy_amount ?? 0),
    reimbursed_amount: Number(r.reimbursed_amount ?? 0),
    receipt_no: r.receipt_no ?? "",
    note: r.note ?? "",
    reimbursement_status: normalizeStatus(r.status),
    category: r.metadata?.category ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at
  }));

  const receiptIds = receipts.map((r) => r.receipt_id);

  // ── 3. Fetch only claims for this user's receipts ─────────────────────────
  const { data: claimsRaw, error: claimsError } = receiptIds.length
    ? await supabase
        .from("receipt_claims")
        .select(EMPLOYEE_CLAIM_SELECT)
        .in("receipt_id", receiptIds)
        .order("claim_date", { ascending: false })
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (claimsError) return NextResponse.json({ error: claimsError.message }, { status: 500 });

  const allocations = (claimsRaw ?? []).map((c: any) => ({
    allocation_id: c.id,
    receipt_id: c.receipt_id,
    date: c.claim_date,
    employee_id: c.profile_id,
    amount: Number(c.claimed_amount ?? 0),
    note: c.note ?? "",
    created_at: c.created_at,
    updated_at: c.updated_at
  }));

  // ── 4. Fetch attachments for this user's receipts ─────────────────────────
  const { data: attachmentsRaw, error: attachmentsError } = receiptIds.length
    ? await supabase
        .from("receipt_attachments")
        .select(EMPLOYEE_ATTACHMENT_SELECT)
        .in("receipt_id", receiptIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (attachmentsError) return NextResponse.json({ error: attachmentsError.message }, { status: 500 });

  const attachments = (attachmentsRaw ?? []).map((a: any) => ({
    attachment_id: a.id,
    receipt_id: a.receipt_id,
    bucket: a.bucket ?? RECEIPT_IMAGE_BUCKET,
    object_path: a.object_path,
    file_name: a.object_path?.split("/").pop() ?? "receipt.jpg",
    content_type: a.content_type ?? "image/jpeg",
    size_bytes: Number(a.size_bytes ?? 0),
    created_at: a.created_at
  }));

  if (mode === "receipts") {
    return NextResponse.json({
      employees: [currentEmployee],
      receipts,
      allocations,
      attachments,
      hasMore
    });
  }

  // ── 5. Financial summary calculation ─────────────────────────────────────
  const { data: summaryData, error: summaryError } = await supabase.rpc("employee_receipt_summary", {
    target_profile_id: currentProfileId
  });
  if (summaryError) return NextResponse.json({ error: summaryError.message }, { status: 500 });
  const summary = normalizeEmployeeSummary(summaryData);

  return NextResponse.json({
    employees: [currentEmployee],
    allowedClaimants: [currentEmployee],
    departments: currentEmployee.department_id
      ? [{ id: currentEmployee.department_id, name: currentEmployee.department_name ?? "", active: true }]
      : [],
    receipts,
    allocations,
    attachments,
    summary,
    hasMore
  });
}

async function loadAllowedDirectory(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  session: AppSession,
  currentEmployee: any
) {
  let allowedClaimants: any[] = [currentEmployee];
  let allowedDepartments: any[] = [];
  try {
    if (session.role === "super_admin") {
      const { data: allProfiles } = await supabase
        .from("profiles")
        .select(EMPLOYEE_PROFILE_SELECT)
        .eq("active", true)
        .order("display_name", { ascending: true });
      const { data: allDepts } = await supabase.from("departments").select("*").eq("active", true);
      allowedClaimants = (allProfiles ?? []).map((p: any) => ({
        employee_id: p.id, name: p.display_name, active: p.active,
        department_id: p.department_id, department_name: p.departments?.name ?? null,
        note: [p.employee_no, p.email].filter(Boolean).join(" / "),
        created_at: p.created_at, updated_at: p.updated_at
      }));
      allowedDepartments = allDepts ?? [];
    } else if (session.role === "employee") {
      const myDeptId = currentEmployee.department_id;
      const targetDeptIds = new Set<string>();
      if (myDeptId) targetDeptIds.add(myDeptId);

      const { data: sharedAdmins } = myDeptId
        ? await supabase
            .from("department_admin_departments")
            .select("admin_profile_id")
            .eq("department_id", myDeptId)
        : { data: [] };

      const adminIds = [...new Set((sharedAdmins ?? []).map((scope: any) => scope.admin_profile_id))];
      const { data: managedScopes } = adminIds.length
        ? await supabase
            .from("department_admin_departments")
            .select("department_id")
            .in("admin_profile_id", adminIds)
        : { data: [] };

      for (const scope of managedScopes ?? []) {
        if (scope.department_id) targetDeptIds.add(scope.department_id);
      }

      const targetIdsArray = [...targetDeptIds];
      const [{ data: targetProfiles }, { data: targetDepts }] = await Promise.all([
        targetIdsArray.length
          ? supabase.from("profiles").select(EMPLOYEE_PROFILE_SELECT)
              .in("department_id", targetIdsArray).eq("active", true).eq("app_role", "employee").order("display_name", { ascending: true })
          : Promise.resolve({ data: [] }),
        targetIdsArray.length
          ? supabase.from("departments").select("*").in("id", targetIdsArray).eq("active", true)
          : Promise.resolve({ data: [] })
      ]);

      allowedClaimants = (targetProfiles ?? []).map((p: any) => ({
        employee_id: p.id, name: p.display_name, active: p.active,
        department_id: p.department_id, department_name: p.departments?.name ?? null,
        note: [p.employee_no, p.email].filter(Boolean).join(" / "),
        created_at: p.created_at, updated_at: p.updated_at
      }));
      allowedDepartments = targetDepts ?? [];
    } else {
      const targetDeptIds = session.departmentIds;
      const [{ data: targetProfiles }, { data: targetDepts }] = await Promise.all([
        targetDeptIds.length
          ? supabase.from("profiles").select(EMPLOYEE_PROFILE_SELECT)
              .in("department_id", targetDeptIds).eq("active", true).eq("app_role", "employee").order("display_name", { ascending: true })
          : Promise.resolve({ data: [] }),
        targetDeptIds.length
          ? supabase.from("departments").select("*").in("id", targetDeptIds).eq("active", true)
          : Promise.resolve({ data: [] })
      ]);
      allowedClaimants = (targetProfiles ?? []).map((p: any) => ({
        employee_id: p.id, name: p.display_name, active: p.active,
        department_id: p.department_id, department_name: p.departments?.name ?? null,
        note: [p.employee_no, p.email].filter(Boolean).join(" / "),
        created_at: p.created_at, updated_at: p.updated_at
      }));
      allowedDepartments = targetDepts ?? [];
    }
  } catch (err) {
    console.error("[bootstrap] allowedClaimants lookup failed:", err);
  }

  return { allowedClaimants, allowedDepartments };
}

function clampOffset(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function clampLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECEIPT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_RECEIPT_LIMIT);
}

function normalizeEmployeeSummary(value: any) {
  return {
    submittedTotal: Number(value?.submittedTotal ?? 0),
    paidTotal: Number(value?.paidTotal ?? 0),
    unpaidTotal: Number(value?.unpaidTotal ?? 0),
    pendingCount: Number(value?.pendingCount ?? 0),
    pendingTotalAmount: Number(value?.pendingTotalAmount ?? 0),
    pendingClaimableAmount: Number(value?.pendingClaimableAmount ?? 0)
  };
}
