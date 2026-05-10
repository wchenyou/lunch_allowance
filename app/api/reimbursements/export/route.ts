import { requireSession } from "@/app/lib/api/guards";
import { buildReimbursementReport } from "@/app/lib/calculations";
import { readDb } from "@/app/lib/storage";

const csvEscape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const report = buildReimbursementReport(await readDb(), start, end);
  const lines = [
    ["type", "date", "payer", "employee", "receipt_id", "merchant", "receipt_no", "allocated_amount", "reimbursable_amount", "status"],
    ...report.payerSummaries.map((summary) => [
      "payer_summary",
      `${start}~${end}`,
      summary.payer_name,
      "",
      "",
      "",
      "",
      "",
      summary.reimbursable,
      ""
    ]),
    ...report.allocations.map((allocation) => [
      "allocation",
      allocation.date,
      allocation.payer?.name ?? "Unknown",
      allocation.employee?.name ?? "Unknown",
      allocation.receipt_id,
      allocation.receipt.merchant,
      allocation.receipt.receipt_no,
      allocation.amount,
      allocation.reimbursable_amount,
      allocation.receipt.reimbursement_status
    ])
  ];
  const csv = lines.map((line) => line.map(csvEscape).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lunch-reimbursements-${start || "all"}-${end || "all"}.csv"`
    }
  });
}
