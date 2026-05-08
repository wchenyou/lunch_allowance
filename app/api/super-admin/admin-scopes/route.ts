import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const supabase = createSupabaseAdminClient();
  const [departments, employees] = await Promise.all([
    supabase.from("department_admin_departments").select("*"),
    supabase.from("department_admin_employees").select("*")
  ]);
  const error = departments.error ?? employees.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ departmentScopes: departments.data ?? [], employeeScopes: employees.data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const adminProfileId = String(input.admin_profile_id ?? "").trim();
  const departmentIds: string[] = Array.isArray(input.department_ids) ? input.department_ids.map((departmentId: unknown) => String(departmentId)) : [];
  const employeeIds: string[] = Array.isArray(input.employee_ids) ? input.employee_ids.map((employeeId: unknown) => String(employeeId)) : [];
  if (!adminProfileId) return NextResponse.json({ error: "admin_profile_id is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const deleteDepartments = await supabase.from("department_admin_departments").delete().eq("admin_profile_id", adminProfileId);
  const deleteEmployees = await supabase.from("department_admin_employees").delete().eq("admin_profile_id", adminProfileId);
  const deleteError = deleteDepartments.error ?? deleteEmployees.error;
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

  if (departmentIds.length) {
    const { error } = await supabase.from("department_admin_departments").insert(
      departmentIds.map((departmentId) => ({ admin_profile_id: adminProfileId, department_id: departmentId, created_by: guard.session?.profileId }))
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (employeeIds.length) {
    const { error } = await supabase.from("department_admin_employees").insert(
      employeeIds.map((employeeId) => ({ admin_profile_id: adminProfileId, employee_profile_id: employeeId, created_by: guard.session?.profileId }))
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
