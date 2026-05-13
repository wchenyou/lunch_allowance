import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { calculateDailyClaimSubsidies, normalizeStatus } from "@/app/lib/calculations";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;

  const currentProfileId = guard.session!.profileId;
  const supabase = createSupabaseAdminClient();

  // ── 1. Fetch current user's profile (single row) ──────────────────────────
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("*, departments!profiles_department_id_fkey(name)")
    .eq("id", currentProfileId)
    .single();

  if (profileError || !profileData) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const currentEmployee = {
    employee_id: profileData.id,
    name: profileData.display_name,
    active: profileData.active,
    note: [profileData.employee_no, profileData.email].filter(Boolean).join(" / "),
    department_id: profileData.department_id,
    department_name: profileData.departments?.name ?? null,
    created_at: profileData.created_at,
    updated_at: profileData.updated_at
  };

  // ── 2. Fetch only this user's receipts (not all receipts) ─────────────────
  const { data: receiptsRaw, error: receiptsError } = await supabase
    .from("receipts")
    .select("*")
    .or(`submitted_by.eq.${currentProfileId},payer_profile_id.eq.${currentProfileId}`)
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (receiptsError) return NextResponse.json({ error: receiptsError.message }, { status: 500 });

  const receipts = (receiptsRaw ?? []).map((r: any) => ({
    receipt_id: r.id,
    date: r.receipt_date,
    payer_employee_id: r.payer_profile_id ?? r.submitted_by,
    submitted_by: r.submitted_by,
    department_id: r.department_id,
    applicant_name: r.metadata?.applicant_name,
    claimant_names: Array.isArray(r.metadata?.claimant_names) ? r.metadata.claimant_names : [],
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
        .select("*")
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
  const { data: attachmentsRaw } = receiptIds.length
    ? await supabase
        .from("receipt_attachments")
        .select("*")
        .in("receipt_id", receiptIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  let attachments = (attachmentsRaw ?? []).map((a: any) => ({
    attachment_id: a.id,
    receipt_id: a.receipt_id,
    bucket: a.bucket ?? RECEIPT_IMAGE_BUCKET,
    object_path: a.object_path,
    file_name: a.object_path?.split("/").pop() ?? "receipt.jpg",
    content_type: a.content_type ?? "image/jpeg",
    size_bytes: Number(a.size_bytes ?? 0),
    created_at: a.created_at
  }));

  // ── 5. Signed URLs for attachments ────────────────────────────────────────
  if (attachments.length > 0) {
    const bucket = process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
    const paths = attachments.map((a) => a.object_path);
    const { data: signedUrlsData } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    if (signedUrlsData) {
      const urlMap = new Map(signedUrlsData.map((d) => [d.path, d.signedUrl]));
      attachments = attachments.map((a) => ({ ...a, signed_url: urlMap.get(a.object_path) ?? undefined }));
    }
  }

  // ── 6. Allowed claimants & departments (scoped lookup) ───────────────────
  let allowedClaimants: any[] = [currentEmployee];
  let allowedDepartments: any[] = [];

  try {
    if (guard.session!.role === "super_admin") {
      const { data: allProfiles } = await supabase
        .from("profiles")
        .select("*, departments!profiles_department_id_fkey(name)")
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
    } else {
      // Find which admins manage this employee's department, then get all their managed depts
      const myDeptId = currentEmployee.department_id;
      const targetDeptIds = new Set<string>(myDeptId ? [myDeptId] : []);

      const [{ data: myDeptAdmins }, { data: claimantPerms }] = await Promise.all([
        myDeptId
          ? supabase.from("department_admin_departments").select("admin_profile_id").eq("department_id", myDeptId)
          : Promise.resolve({ data: [] }),
        supabase.from("claimant_permissions").select("claimant_profile_id").eq("employee_profile_id", currentProfileId)
      ]);

      const adminIds = new Set([...(myDeptAdmins ?? []).map((s: any) => s.admin_profile_id), currentProfileId]);
      const { data: allManagedScopes } = await supabase
        .from("department_admin_departments")
        .select("department_id")
        .in("admin_profile_id", Array.from(adminIds));

      for (const scope of allManagedScopes ?? []) {
        if (scope.department_id) targetDeptIds.add(scope.department_id);
      }

      const targetIdsArray = Array.from(targetDeptIds);
      const [{ data: targetProfiles }, { data: targetDepts }] = await Promise.all([
        targetIdsArray.length
          ? supabase.from("profiles").select("*, departments!profiles_department_id_fkey(name)")
              .in("department_id", targetIdsArray).eq("active", true).order("display_name", { ascending: true })
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
    }
  } catch (err) {
    console.error("[bootstrap] allowedClaimants lookup failed:", err);
  }

  // ── 7. Financial summary calculation ─────────────────────────────────────
  const ownAllocations = allocations.filter((a) => a.employee_id === currentProfileId);
  const paidReceiptIds = new Set(
    receipts.filter((r) => normalizeStatus(r.reimbursement_status) === "paid").map((r) => r.receipt_id)
  );
  const submittedTotal = receipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
  const paidTotal = ownAllocations
    .filter((a) => paidReceiptIds.has(a.receipt_id))
    .reduce((sum, a) => sum + Number(a.amount || 0), 0);

  const pendingReceipts = receipts.filter(
    (r) => normalizeStatus(r.reimbursement_status) !== "paid" && normalizeStatus(r.reimbursement_status) !== "rejected"
  );
  const pendingReceiptIds = new Set(pendingReceipts.map((r) => r.receipt_id));
  const allPendingClaims = ownAllocations
    .filter((a) => pendingReceiptIds.has(a.receipt_id))
    .map((a) => ({ id: a.allocation_id, profileId: a.employee_id, claimDate: a.date, claimedAmount: a.amount, createdAt: a.created_at }));
  const calculatedPendingSubsidies = calculateDailyClaimSubsidies(allPendingClaims);
  const totalSubsidy = calculatedPendingSubsidies.reduce((sum, s) => sum + s.subsidyAmount, 0);

  return NextResponse.json({
    employees: [currentEmployee],
    allowedClaimants,
    departments: allowedDepartments,
    receipts,
    allocations,
    attachments,
    summary: {
      submittedTotal,
      paidTotal,
      unpaidTotal: Math.max(0, submittedTotal - paidTotal),
      pendingCount: pendingReceipts.length,
      pendingTotalAmount: pendingReceipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0),
      pendingClaimableAmount: totalSubsidy
    }
  });
}
