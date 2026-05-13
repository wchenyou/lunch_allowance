import JSZip from "jszip";
import { requireSession } from "@/app/lib/api/guards";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const MAX_ZIP_FILES = 200;

export async function GET(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const employee = url.searchParams.get("employee") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const category = url.searchParams.get("category") ?? "";
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("receipts")
    .select("id, submitted_by, department_id, status, receipt_date, metadata, receipt_claims(profile_id), receipt_attachments(*)")
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (guard.session!.departmentIds.length) query = query.in("department_id", guard.session!.departmentIds);
  if (employee) {
    const { data: employeeClaims, error: employeeClaimsError } = await supabase
      .from("receipt_claims")
      .select("receipt_id")
      .eq("profile_id", employee)
      .limit(2000);
    if (employeeClaimsError) return new Response(employeeClaimsError.message, { status: 500 });
    const claimReceiptIds = [...new Set((employeeClaims ?? []).map((claim) => claim.receipt_id))];
    query = claimReceiptIds.length
      ? query.or(`submitted_by.eq.${employee},id.in.(${claimReceiptIds.join(",")})`)
      : query.eq("submitted_by", employee);
  }
  if (start) query = query.gte("receipt_date", start);
  if (end) query = query.lte("receipt_date", end);
  if (status) query = query.eq("status", status);
  if (category) {
    query = category === "餐費補助"
      ? query.or("metadata->>category.eq.餐費補助,metadata->>category.is.null")
      : query.eq("metadata->>category", category);
  }
  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });
  const receipts = data ?? [];
  const attachments = receipts.flatMap((receipt: any) => receipt.receipt_attachments ?? []);
  if (attachments.length > MAX_ZIP_FILES) {
    return new Response(`查詢結果包含 ${attachments.length} 張照片，超過單次匯出上限 ${MAX_ZIP_FILES} 張。請縮小日期、員工、狀態或項目範圍後再匯出。`, { status: 413 });
  }
  const zip = new JSZip();
  const bucket = process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
  for (const attachment of attachments) {
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
