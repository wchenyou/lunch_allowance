import { NextResponse } from "next/server";
import { upsertReceipt } from "@/app/lib/storage";

export async function POST(request: Request) {
  const input = await request.json();
  const profileId = String(input.profile_id ?? input.payer_employee_id ?? "").trim();
  const date = String(input.date ?? "").trim();
  const totalAmount = Number(input.total_amount);
  const allocations = Array.isArray(input.allocations)
    ? input.allocations
    : [{ employee_id: profileId, amount: totalAmount, note: input.note ?? "" }];

  if (!profileId || !date || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    return NextResponse.json({ error: "profile_id, date, and total_amount are required" }, { status: 400 });
  }

  const invalidAllocation = allocations.some((allocation: any) => !allocation.employee_id || Number(allocation.amount) <= 0);
  if (invalidAllocation) {
    return NextResponse.json({ error: "Each claim requires employee_id and positive amount" }, { status: 400 });
  }

  try {
    const db = await upsertReceipt({
      date,
      payer_employee_id: profileId,
      merchant: input.merchant ?? "",
      total_amount: totalAmount,
      receipt_no: input.receipt_no ?? "",
      note: input.note ?? "",
      reimbursement_status: "pending",
      allocations
    });
    return NextResponse.json(db);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit receipt" }, { status: 500 });
  }
}
