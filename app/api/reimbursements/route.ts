import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { buildReimbursementReport } from "@/app/lib/calculations";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { hasSupabaseConfig, readDb } from "@/app/lib/storage";
import type { Database } from "@/app/lib/types";

export async function GET(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const url = new URL(request.url);
  const db = hasSupabaseConfig() ? await readScopedSupabaseDb(guard.session!.departmentIds) : await readDb();
  return NextResponse.json(buildReimbursementReport(db, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? ""));
}

async function readScopedSupabaseDb(departmentIds: string[]): Promise<Database> {
  if (!departmentIds.length) {
    return { employees: [], receipts: [], allocations: [], attachments: [] };
  }

  const supabase = createSupabaseAdminClient();
  const [profiles, receipts] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, active, employee_no, email, department_id, created_at, updated_at")
      .in("department_id", departmentIds)
      .order("display_name", { ascending: true }),
    supabase
      .from("receipts")
      .select("id, receipt_date, payer_profile_id, submitted_by, department_id, merchant, total_amount, receipt_no, note, status, created_at, updated_at")
      .in("department_id", departmentIds)
      .order("receipt_date", { ascending: false })
      .order("created_at", { ascending: false })
  ]);

  const error = profiles.error ?? receipts.error;
  if (error) throw new Error(error.message);

  const receiptIds = (receipts.data ?? []).map((receipt) => receipt.id);
  const { data: claims, error: claimsError } = receiptIds.length
    ? await supabase
        .from("receipt_claims")
        .select("id, receipt_id, claim_date, profile_id, claimed_amount, note, created_at, updated_at")
        .in("receipt_id", receiptIds)
        .order("claim_date", { ascending: false })
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (claimsError) throw new Error(claimsError.message);

  return {
    employees: (profiles.data ?? []).map((profile) => ({
      employee_id: profile.id,
      name: profile.display_name,
      active: profile.active,
      note: [profile.employee_no, profile.email].filter(Boolean).join(" / "),
      department_id: profile.department_id,
      created_at: profile.created_at,
      updated_at: profile.updated_at
    })),
    receipts: (receipts.data ?? []).map((receipt) => ({
      receipt_id: receipt.id,
      date: receipt.receipt_date,
      payer_employee_id: receipt.payer_profile_id ?? receipt.submitted_by,
      submitted_by: receipt.submitted_by,
      department_id: receipt.department_id,
      merchant: receipt.merchant ?? "",
      total_amount: Number(receipt.total_amount ?? 0),
      receipt_no: receipt.receipt_no ?? "",
      note: receipt.note ?? "",
      reimbursement_status: receipt.status === "settled" || receipt.status === "approved" ? "paid" : receipt.status === "rejected" ? "rejected" : "pending",
      created_at: receipt.created_at,
      updated_at: receipt.updated_at
    })),
    allocations: (claims ?? []).map((claim) => ({
      allocation_id: claim.id,
      receipt_id: claim.receipt_id,
      date: claim.claim_date,
      employee_id: claim.profile_id,
      amount: Number(claim.claimed_amount ?? 0),
      note: claim.note ?? "",
      created_at: claim.created_at,
      updated_at: claim.updated_at
    })),
    attachments: []
  };
}
