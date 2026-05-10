import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { isSystemDepartment } from "@/app/lib/departments";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { normalizeIds, supabaseErrorResponse } from "../_utils";

export async function GET() {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const supabase = createSupabaseAdminClient();
  const [departments, employees] = await Promise.all([
    supabase.from("department_admin_departments").select("*"),
    supabase.from("department_admin_employees").select("*")
  ]);
  const error = departments.error ?? employees.error;
  if (error) return supabaseErrorResponse("讀取管理範圍", error, 500);
  return NextResponse.json({ departmentScopes: departments.data ?? [], employeeScopes: employees.data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const adminProfileId = String(input.admin_profile_id ?? "").trim();
  const departmentIds = normalizeIds(input.department_ids);
  const employeeIds = normalizeIds(input.employee_ids);
  if (!adminProfileId) return NextResponse.json({ error: "admin_profile_id is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: adminProfile, error: profileError } = await supabase.from("profiles").select("id, app_role").eq("id", adminProfileId).single();
  if (profileError) return supabaseErrorResponse("讀取部門行政帳號", profileError, 404);
  if (!adminProfile) return NextResponse.json({ error: "找不到部門行政帳號" }, { status: 404 });
  if (adminProfile.app_role !== "department_admin") return NextResponse.json({ error: "只有部門行政帳號可設定管理部門" }, { status: 400 });
  if (departmentIds.length) {
    const { data: selectedDepartments, error: departmentError } = await supabase
      .from("departments")
      .select("id, code, name, active")
      .in("id", departmentIds);
    if (departmentError) return supabaseErrorResponse("驗證部門資料", departmentError);
    if ((selectedDepartments ?? []).length !== departmentIds.length || (selectedDepartments ?? []).some((department) => !department.active || isSystemDepartment(department))) {
      return NextResponse.json({ error: "不可授權不存在、停用或系統管理部門" }, { status: 400 });
    }
  }

  const deleteDepartments = await supabase.from("department_admin_departments").delete().eq("admin_profile_id", adminProfileId);
  const deleteEmployees = await supabase.from("department_admin_employees").delete().eq("admin_profile_id", adminProfileId);
  const deleteError = deleteDepartments.error ?? deleteEmployees.error;
  if (deleteError) return supabaseErrorResponse("清除管理範圍", deleteError);

  if (departmentIds.length) {
    const { error } = await supabase
      .from("department_admin_departments")
      .upsert(departmentIds.map((departmentId) => ({ admin_profile_id: adminProfileId, department_id: departmentId, created_by: guard.session?.profileId ?? null })), {
        onConflict: "admin_profile_id,department_id",
        ignoreDuplicates: true
      });
    if (error) return supabaseErrorResponse("儲存管理部門", error);
  }
  if (employeeIds.length) {
    const { error } = await supabase
      .from("department_admin_employees")
      .upsert(employeeIds.map((employeeId) => ({ admin_profile_id: adminProfileId, employee_profile_id: employeeId, created_by: guard.session?.profileId ?? null })), {
        onConflict: "admin_profile_id,employee_profile_id",
        ignoreDuplicates: true
      });
    if (error) return supabaseErrorResponse("儲存管理員工", error);
  }
  return NextResponse.json({ ok: true });
}
