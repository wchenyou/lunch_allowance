import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { requireDepartmentAdminEmployeeScope } from "@/app/lib/api/scope";
import { upsertEmployee } from "@/app/lib/storage";

export async function POST(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  if (!input.name?.trim()) return NextResponse.json({ error: "姓名必填" }, { status: 400 });
  const employeeId = String(input.employee_id ?? "").trim();
  if (!employeeId) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  const scopeError = await requireDepartmentAdminEmployeeScope(guard.session!, employeeId);
  if (scopeError) return scopeError;
  const db = await upsertEmployee({ ...input, name: input.name.trim() });
  return NextResponse.json(db);
}
