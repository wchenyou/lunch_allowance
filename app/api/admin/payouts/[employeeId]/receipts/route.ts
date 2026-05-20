import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

type Params = { params: Promise<{ employeeId: string }> };

const RECEIPT_SELECT = "id, receipt_date, department_id, submitted_by, payer_profile_id, merchant, receipt_no, total_amount, claimed_amount, subsidy_amount, reimbursed_amount, status, note, metadata, created_at, updated_at";
const CLAIM_SELECT = "id, receipt_id, profile_id, claimed_amount, subsidy_amount, reimbursed_amount, status, created_at, updated_at";
const ATTACHMENT_SELECT = "id, receipt_id, object_path, created_at";

export async function GET(_request: Request, { params }: Params) {
  const guard = await requireSession(["department_admin", "super_admin"]);
  if (guard.response) return guard.response;

  const { employeeId } = await params;
  const session = guard.session!;
  const supabase = createSupabaseAdminClient();
  const departmentIds = session.role === "super_admin" ? undefined : session.departmentIds;
  if (departmentIds && departmentIds.length === 0) {
    return NextResponse.json({ receipts: [], claims: [], attachments: [] });
  }

  const profileQuery = supabase
    .from("profiles")
    .select("id, department_id, app_role, active, login_disabled_at")
    .eq("id", employeeId)
    .single();
  const { data: profile, error: profileError } = await profileQuery;
  if (profileError || !profile) {
    return NextResponse.json({ error: profileError?.message ?? "Employee not found" }, { status: 404 });
  }
  if (
    profile.app_role !== "employee" ||
    !profile.active ||
    profile.login_disabled_at ||
    (departmentIds && (!profile.department_id || !departmentIds.includes(profile.department_id)))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let receiptQuery = supabase
    .from("receipts")
    .select(RECEIPT_SELECT)
    .eq("submitted_by", employeeId)
    .eq("status", "submitted")
    .order("created_at", { ascending: false });
  if (departmentIds?.length) receiptQuery = receiptQuery.in("department_id", departmentIds);

  const { data: receipts, error: receiptError } = await receiptQuery;
  if (receiptError) return NextResponse.json({ error: receiptError.message }, { status: 500 });

  const receiptIds = (receipts ?? []).map((receipt) => receipt.id);
  const [claims, attachments] = await Promise.all([
    receiptIds.length
      ? supabase.from("receipt_claims").select(CLAIM_SELECT).in("receipt_id", receiptIds)
      : Promise.resolve({ data: [], error: null }),
    receiptIds.length
      ? supabase.from("receipt_attachments").select(ATTACHMENT_SELECT).in("receipt_id", receiptIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  const error = claims.error ?? attachments.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    receipts: receipts ?? [],
    claims: claims.data ?? [],
    attachments: (attachments.data ?? []).map((attachment) => ({
      ...attachment,
      file_name: attachment.object_path.split("/").pop()
    }))
  });
}
