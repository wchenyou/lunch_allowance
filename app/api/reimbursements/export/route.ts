import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const csvEscape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
const statusLabel = (status: string) => (status === "settled" ? "已放款" : status === "rejected" ? "退單" : "申請中");
const moneyText = (value: number) => `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0)}`;

export async function GET(request: Request) {
  const guard = await requireSession(["department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const employee = url.searchParams.get("employee") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const category = url.searchParams.get("category") ?? "";
  const supabase = createSupabaseAdminClient();
  const receiptSelect: string = employee
    ? "*, departments(name), receipt_claims(*, profiles(display_name)), receipt_attachments(*), filter_claims:receipt_claims!inner(profile_id)"
    : "*, departments(name), receipt_claims(*, profiles(display_name)), receipt_attachments(*)";
  let query = supabase
    .from("receipts")
    .select(receiptSelect)
    .order("receipt_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (guard.session!.departmentIds.length) query = query.in("department_id", guard.session!.departmentIds);
  if (employee) {
    query = query.eq("filter_claims.profile_id", employee);
  }
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
  const receipts = data ?? [];
  const lines = [
    ["編號", "申請日期", "單據日期", "項目", "店家名稱", "部門", "請款人名稱", "請款人數", "單據金額", "可請款金額", "單據狀態", "單據照片名稱", "備註"],
    ...receipts.map((receipt: any, index: number) => {
      const claims = receipt.receipt_claims ?? [];
      const attachments = receipt.receipt_attachments ?? [];
      return [
        index + 1,
        (receipt.created_at ?? "").slice(0, 10),
        receipt.receipt_date,
        receipt.metadata?.category ?? "餐費補助",
        receipt.merchant ?? "",
        receipt.departments?.name ?? "",
        claims.map((claim: any) => `${claim.profiles?.display_name ?? ""}(${moneyText(Number(claim.claimed_amount ?? 0))})`).filter((value: string) => !value.startsWith("(")).join("、"),
        claims.length,
        Number(receipt.total_amount ?? 0),
        claims.reduce((sum: number, claim: any) => sum + Number(claim.subsidy_amount ?? 0), 0),
        statusLabel(receipt.status),
        attachments.map((attachment: any) => attachment.object_path?.split("/").pop()).filter(Boolean).join("、"),
        receipt.note ?? ""
      ];
    })
  ];
  const csv = lines.map((line) => line.map(csvEscape).join(",")).join("\n");
  const bom = "\uFEFF";
  const csvWithBom = bom + csv;
  return new Response(csvWithBom, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lunch-reimbursements-${start || "all"}-${end || "all"}.csv"`
    }
  });
}
