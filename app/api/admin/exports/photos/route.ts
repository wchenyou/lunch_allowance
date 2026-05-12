import JSZip from "jszip";
import { requireSession } from "@/app/lib/api/guards";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const employee = url.searchParams.get("employee") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("receipts").select("id, submitted_by, department_id, status, receipt_date, receipt_claims(profile_id), receipt_attachments(*)");
  if (guard.session!.departmentIds.length) query = query.in("department_id", guard.session!.departmentIds);
  if (start) query = query.gte("receipt_date", start);
  if (end) query = query.lte("receipt_date", end);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });
  const receipts = (data ?? []).filter((receipt: any) => !employee || receipt.submitted_by === employee || receipt.receipt_claims?.some((claim: any) => claim.profile_id === employee));
  const zip = new JSZip();
  const bucket = process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
  for (const attachment of receipts.flatMap((receipt: any) => receipt.receipt_attachments ?? [])) {
    const downloaded = await supabase.storage.from(bucket).download(attachment.object_path);
    if (downloaded.error || !downloaded.data) continue;
    const arrayBuffer = await downloaded.data.arrayBuffer();
    zip.file(attachment.object_path.split("/").pop() ?? "receipt.jpg", arrayBuffer);
  }
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=\"receipt-images-${start || "all"}-${end || "all"}.zip\"`
    }
  });
}
