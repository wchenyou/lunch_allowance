import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const DEFAULT_RECEIPT_LIMIT = 200;
const MAX_RECEIPT_LIMIT = 500;
const DEPARTMENT_SELECT = "id, code, name, active, created_at, updated_at";
const PROFILE_SELECT = "id, employee_no, display_name, email, phone, department_id, role, app_role, active, onboarded_at, created_at, updated_at";
const RECEIPT_SELECT = "id, receipt_date, department_id, submitted_by, payer_profile_id, merchant, receipt_no, total_amount, claimed_amount, subsidy_amount, reimbursed_amount, status, note, metadata, created_at, updated_at";
const CLAIM_SELECT = "id, receipt_id, profile_id, claimed_amount, subsidy_amount, reimbursed_amount, status, created_at, updated_at";
const ATTACHMENT_SELECT = "id, receipt_id, object_path, created_at";

export async function GET(request: Request) {
  const guard = await requireSession(["department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const session = guard.session!;
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const employee = url.searchParams.get("employee") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const category = url.searchParams.get("category") ?? "";
  const mode = url.searchParams.get("mode") ?? "dashboard";
  const view = url.searchParams.get("view") ?? (mode === "stats" ? "stats" : "receipts");
  const limit = clampLimit(url.searchParams.get("limit"));
  const supabase = createSupabaseAdminClient();
  const departmentIds = session.role === "super_admin" ? undefined : session.departmentIds;
  if (departmentIds && departmentIds.length === 0) {
    return NextResponse.json({
      departments: [],
      profiles: [],
      receipts: [],
      claims: [],
      attachments: [],
      summary: emptyAdminSummary(),
      session,
      limited: false
    });
  }

  const departmentQuery = supabase.from("departments").select(DEPARTMENT_SELECT).order("name", { ascending: true });
  const profileQuery = supabase.from("profiles").select(PROFILE_SELECT).order("display_name", { ascending: true });
  const receiptSelect: string = employee ? `${RECEIPT_SELECT}, filter_claims:receipt_claims!inner(profile_id)` : RECEIPT_SELECT;
  let receiptQuery = supabase
    .from("receipts")
    .select(receiptSelect)
    .order("created_at", { ascending: false });

  if (departmentIds?.length) {
    departmentQuery.in("id", departmentIds);
    profileQuery.in("department_id", departmentIds);
    receiptQuery.in("department_id", departmentIds);
  }
  if (employee) {
    receiptQuery = receiptQuery.eq("filter_claims.profile_id", employee);
  }
  if (start) receiptQuery = receiptQuery.gte("receipt_date", start);
  if (end) receiptQuery = receiptQuery.lte("receipt_date", end);
  if (status) receiptQuery = receiptQuery.eq("status", status);
  if (category) {
    receiptQuery = category === "餐費補助"
      ? receiptQuery.or("metadata->>category.eq.餐費補助,metadata->>category.is.null")
      : receiptQuery.eq("metadata->>category", category);
  }
  receiptQuery = receiptQuery.limit(mode === "stats" ? limit : DEFAULT_RECEIPT_LIMIT + 1);

  const shouldLoadDirectory = view !== "summary";
  const shouldLoadReceipts = view !== "summary";
  const shouldLoadSummary = mode !== "stats";
  const [departments, profiles, receipts, summaryResult] = await Promise.all([
    shouldLoadDirectory ? departmentQuery : Promise.resolve({ data: [], error: null }),
    shouldLoadDirectory ? profileQuery : Promise.resolve({ data: [], error: null }),
    shouldLoadReceipts ? receiptQuery : Promise.resolve({ data: [], error: null }),
    shouldLoadSummary
      ? supabase.rpc("admin_receipt_dashboard_summary", { scoped_department_ids: departmentIds ?? null })
      : Promise.resolve({ data: null, error: null })
  ]);
  const allReceipts = ((receipts.data ?? []) as any[]);
  const limited = mode !== "stats" && allReceipts.length > DEFAULT_RECEIPT_LIMIT;
  let scopedReceipts = limited ? allReceipts.slice(0, DEFAULT_RECEIPT_LIMIT) : allReceipts;
  const initialReceiptIds = scopedReceipts.map((receipt) => receipt.id);
  const shouldLoadAttachments = view === "receipts" || view === "stats";
  const [claims, attachments] = await Promise.all([
    initialReceiptIds.length ? supabase.from("receipt_claims").select(CLAIM_SELECT).in("receipt_id", initialReceiptIds) : Promise.resolve({ data: [], error: null }),
    shouldLoadAttachments && initialReceiptIds.length ? supabase.from("receipt_attachments").select(ATTACHMENT_SELECT).in("receipt_id", initialReceiptIds) : Promise.resolve({ data: [], error: null })
  ]);
  const error = departments.error ?? profiles.error ?? receipts.error ?? summaryResult.error ?? claims.error ?? attachments.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let scopedClaims = claims.data ?? [];
  if (employee) {
    const matchingReceiptIds = new Set(
      scopedReceipts
        .filter((receipt) => receipt.submitted_by === employee || scopedClaims.some((claim) => claim.receipt_id === receipt.id && claim.profile_id === employee))
        .map((receipt) => receipt.id)
    );
    scopedReceipts = scopedReceipts.filter((receipt) => matchingReceiptIds.has(receipt.id));
    scopedClaims = scopedClaims.filter((claim) => matchingReceiptIds.has(claim.receipt_id));
  }
  const receiptIds = new Set(scopedReceipts.map((receipt) => receipt.id));
  const scopedAttachments = (attachments.data ?? []).filter((attachment) => receiptIds.has(attachment.receipt_id)).map((attachment) => ({
    ...attachment,
    file_name: attachment.object_path.split("/").pop()
  }));
  return NextResponse.json({
    departments: departments.data ?? [],
    profiles: profiles.data ?? [],
    receipts: scopedReceipts,
    claims: scopedClaims,
    attachments: scopedAttachments,
    summary: shouldLoadSummary ? normalizeAdminSummary(summaryResult.data) : undefined,
    session,
    limited
  });
}

function clampLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECEIPT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_RECEIPT_LIMIT);
}

function emptyAdminSummary() {
  return {
    pendingApplicantCount: 0,
    pendingReceiptCount: 0,
    totalClaimedAmount: 0,
    totalSubsidyAmount: 0
  };
}

function normalizeAdminSummary(value: any) {
  return {
    pendingApplicantCount: Number(value?.pendingApplicantCount ?? 0),
    pendingReceiptCount: Number(value?.pendingReceiptCount ?? 0),
    totalClaimedAmount: Number(value?.totalClaimedAmount ?? 0),
    totalSubsidyAmount: Number(value?.totalSubsidyAmount ?? 0)
  };
}
