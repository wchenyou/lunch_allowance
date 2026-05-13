import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const csvEscape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
const statusLabel = (status: string) => (status === "settled" ? "已放款" : status === "rejected" ? "退單" : "申請中");

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
    .select("*, departments(name), receipt_claims(*, profiles(display_name)), receipt_attachments(*)")
    .order("receipt_date", { ascending: false });
  if (guard.session!.departmentIds.length) query = query.in("department_id", guard.session!.departmentIds);
  if (start) query = query.gte("receipt_date", start);
  if (end) query = query.lte("receipt_date", end);
  if (status) query = query.eq("status", status);
  if (category) {
    if (category === "餐費補助") {
      // For "餐費補助", include records where category is missing or explicitly "餐費補助"
      query = query.or(`metadata->>category.eq.餐費補助,metadata->>category.is.null`);
    } else {
      query = query.eq("metadata->>category", category);
    }
  }
  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });
  const receipts = (data ?? []).filter((receipt: any) => !employee || receipt.submitted_by === employee || receipt.receipt_claims?.some((claim: any) => claim.profile_id === employee));
  const lines = [
    ["編號", "日期", "項目", "部門", "請款人名稱", "請款人數", "單據金額", "可請款金額", "單據狀態", "單據照片名稱"],
    ...receipts.map((receipt: any, index: number) => {
      const claims = receipt.receipt_claims ?? [];
      const attachments = receipt.receipt_attachments ?? [];
      return [
        index + 1,
        receipt.receipt_date,
        receipt.metadata?.category ?? "餐費補助",
        receipt.departments?.name ?? "",
        claims.map((claim: any) => claim.profiles?.display_name ?? "").filter(Boolean).join("、"),
        claims.length,
        Number(receipt.total_amount ?? 0),
        claims.reduce((sum: number, claim: any) => sum + Number(claim.claimed_amount ?? 0), 0),
        statusLabel(receipt.status),
        attachments.map((attachment: any) => attachment.object_path?.split("/").pop()).filter(Boolean).join("、")
      ];
    })
  ];
  const csv = lines.map((line) => line.map(csvEscape).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lunch-reimbursements-${start || "all"}-${end || "all"}.csv"`
    }
  });
}
