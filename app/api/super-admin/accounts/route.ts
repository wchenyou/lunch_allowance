import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { toLegacyRole, appRoles } from "@/app/lib/auth/roles";
import { hashPassword } from "@/app/lib/auth/password";
import { isSystemDepartment } from "@/app/lib/departments";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { normalizeIds, supabaseErrorResponse } from "../_utils";

export async function GET() {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, employee_no, display_name, email, phone, department_id, role, app_role, active, password_updated_at, login_disabled_at, created_at, updated_at")
    .order("display_name", { ascending: true });
  if (error) return supabaseErrorResponse("讀取帳號資料", error, 500);
  return NextResponse.json({ profiles: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const displayName = String(input.display_name ?? "").trim();
  const appRole = appRoles.includes(input.app_role) ? input.app_role : "employee";
  const departmentIds = normalizeIds(input.department_ids);
  const primaryDepartmentId = String(input.department_id ?? "").trim();
  if (!displayName) return NextResponse.json({ error: "display_name is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const allDepartmentIds = [...new Set([primaryDepartmentId, ...departmentIds].filter(Boolean))];
  if (allDepartmentIds.length) {
    const { data: selectedDepartments, error: departmentError } = await supabase
      .from("departments")
      .select("id, code, name, active")
      .in("id", allDepartmentIds);
    if (departmentError) return supabaseErrorResponse("驗證部門資料", departmentError);
    if ((selectedDepartments ?? []).length !== allDepartmentIds.length || (selectedDepartments ?? []).some((department) => !department.active || isSystemDepartment(department))) {
      return NextResponse.json({ error: "不可選擇不存在、停用或系統管理部門" }, { status: 400 });
    }
  }
  const passwordHash = input.password ? await hashPassword(String(input.password)) : undefined;
  const payload = {
    id: input.id || undefined,
    employee_no: input.employee_no || null,
    display_name: displayName,
    email: input.email || null,
    phone: input.phone || null,
    department_id: primaryDepartmentId || null,
    role: toLegacyRole(appRole),
    app_role: appRole,
    active: input.active ?? true,
    login_disabled_at: input.active === false ? new Date().toISOString() : null,
    password_hash: passwordHash,
    password_updated_at: input.password ? new Date().toISOString() : undefined,
    onboarded_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from("profiles").upsert(payload).select("id, display_name, app_role, department_id, active").single();
  if (error) return supabaseErrorResponse("儲存帳號資料", error);
  if (passwordHash) {
    const { error: credentialError } = await supabase.from("profile_credentials").upsert({
      profile_id: data.id,
      password_hash: passwordHash,
      password_updated_at: new Date().toISOString(),
      must_change_password: input.must_change_password ?? false
    });
    if (credentialError) return supabaseErrorResponse("儲存帳號密碼", credentialError);
  }
  const [deleteDepartments, deleteEmployees] = await Promise.all([
    supabase.from("department_admin_departments").delete().eq("admin_profile_id", data.id),
    supabase.from("department_admin_employees").delete().eq("admin_profile_id", data.id)
  ]);
  const deleteScopeError = deleteDepartments.error ?? deleteEmployees.error;
  if (deleteScopeError) return supabaseErrorResponse("清除管理範圍", deleteScopeError);
  if (appRole === "department_admin" && departmentIds.length) {
    const { error: scopeError } = await supabase
      .from("department_admin_departments")
      .upsert(departmentIds.map((departmentId) => ({ admin_profile_id: data.id, department_id: departmentId, created_by: guard.session?.profileId ?? null })), {
        onConflict: "admin_profile_id,department_id",
        ignoreDuplicates: true
      });
    if (scopeError) return supabaseErrorResponse("儲存管理部門", scopeError);
  }
  return NextResponse.json({ profile: data });
}

export async function DELETE(request: Request) {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const id = String(input.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (id === guard.session?.profileId) return NextResponse.json({ error: "不可停用目前登入帳號" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id, app_role").eq("id", id).single();
  if (profileError) return supabaseErrorResponse("讀取帳號資料", profileError, 404);
  if (!profile) return NextResponse.json({ error: "找不到帳號" }, { status: 404 });
  if (profile.app_role === "super_admin") return NextResponse.json({ error: "最高管理帳號不可透過刪除按鈕停用" }, { status: 400 });
  const timestamp = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ active: false, login_disabled_at: timestamp })
    .eq("id", id)
    .neq("app_role", "super_admin");
  if (error) return supabaseErrorResponse("停用帳號", error);
  await supabase.from("department_admin_departments").delete().eq("admin_profile_id", id);
  await supabase.from("department_admin_employees").delete().eq("admin_profile_id", id);
  return NextResponse.json({ ok: true });
}
