import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { upsertReceipt } from "@/app/lib/storage";

export async function POST(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  if (!input.date || !input.payer_employee_id || !Number.isFinite(Number(input.total_amount))) {
    return NextResponse.json({ error: "date, amount, payer 必填" }, { status: 400 });
  }
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    return NextResponse.json({ error: "至少需要一筆分攤" }, { status: 400 });
  }
  const invalidAllocation = input.allocations.some((allocation: any) => !allocation.employee_id || Number(allocation.amount) <= 0);
  if (invalidAllocation) return NextResponse.json({ error: "每筆分攤都需要員工與正數金額" }, { status: 400 });
  const db = await upsertReceipt(input);
  return NextResponse.json(db);
}
