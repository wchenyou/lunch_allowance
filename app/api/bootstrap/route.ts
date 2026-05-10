import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { readDb } from "@/app/lib/storage";

export async function GET() {
  const guard = await requireSession(["employee", "department_admin"]);
  if (guard.response) return guard.response;
  const db = await readDb();
  if (guard.session?.role === "employee") {
    return NextResponse.json({
      employees: db.employees.filter((employee) => employee.employee_id === guard.session?.profileId),
      receipts: db.receipts.filter((receipt) => receipt.payer_employee_id === guard.session?.profileId),
      allocations: db.allocations.filter((allocation) => allocation.employee_id === guard.session?.profileId)
    });
  }
  return NextResponse.json(db);
}
