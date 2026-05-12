import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { normalizeStatus } from "@/app/lib/calculations";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { readDb } from "@/app/lib/storage";

export async function GET() {
  const guard = await requireSession(["employee", "department_admin"]);
  if (guard.response) return guard.response;
  const db = await readDb();
  if (guard.session?.role === "employee") {
    const ownReceipts = db.receipts.filter((receipt) => receipt.payer_employee_id === guard.session?.profileId || receipt.submitted_by === guard.session?.profileId);
    const ownAllocations = db.allocations.filter((allocation) => allocation.employee_id === guard.session?.profileId);
    let allowedClaimants = db.employees.filter((employee) => employee.employee_id === guard.session?.profileId);
    let signedAttachments = (db.attachments ?? []).filter((attachment) => ownReceipts.some((receipt) => receipt.receipt_id === attachment.receipt_id));
    try {
      const supabase = createSupabaseAdminClient();
      const { data: permissions } = await supabase
        .from("claimant_permissions")
        .select("claimant_profile_id")
        .eq("employee_profile_id", guard.session.profileId);
      const allowedIds = new Set([guard.session.profileId, ...(permissions ?? []).map((permission) => permission.claimant_profile_id)]);
      allowedClaimants = db.employees.filter((employee) => allowedIds.has(employee.employee_id) && employee.active);
      const bucket = process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
      if (signedAttachments.length > 0) {
        const paths = signedAttachments.map((a) => a.object_path);
        const { data: signedUrlsData } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
        if (signedUrlsData) {
          const urlMap = new Map(signedUrlsData.map((d) => [d.path, d.signedUrl]));
          signedAttachments = signedAttachments.map((attachment) => ({
            ...attachment,
            signed_url: urlMap.get(attachment.object_path) ?? null
          }));
        }
      }
    } catch {
      allowedClaimants = db.employees.filter((employee) => employee.employee_id === guard.session?.profileId);
    }
    const paidReceiptIds = new Set(ownReceipts.filter((receipt) => normalizeStatus(receipt.reimbursement_status) === "paid").map((receipt) => receipt.receipt_id));
    const submittedTotal = ownReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0);
    const paidTotal = ownAllocations
      .filter((allocation) => paidReceiptIds.has(allocation.receipt_id))
      .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
    return NextResponse.json({
      employees: db.employees.filter((employee) => employee.employee_id === guard.session?.profileId),
      allowedClaimants,
      receipts: ownReceipts,
      allocations: ownAllocations,
      attachments: signedAttachments,
      summary: {
        submittedTotal,
        paidTotal,
        unpaidTotal: Math.max(0, submittedTotal - paidTotal)
      }
    });
  }
  return NextResponse.json(db);
}
