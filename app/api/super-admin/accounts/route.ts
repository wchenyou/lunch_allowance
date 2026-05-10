import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { toLegacyRole, appRoles } from "@/app/lib/auth/roles";
import { hashPassword } from "@/app/lib/auth/password";
import { isSystemDepartment } from "@/app/lib/departments";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, employee_no, display_name, email, phone, department_id, role, app_role, active, password_updated_at, login_disabled_at, created_at, updated_at")
    .order("display_name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profiles: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const displayName = String(input.display_name ?? "").trim();
  const appRole = appRoles.includes(input.app_role) ? input.app_role : "employee";
  const departmentIds: string[] = Array.isArray(input.department_ids)
    ? input.department_ids.map((departmentId: unknown) => String(departmentId).trim()).filter(Boolean)
    : [];
  if (!displayName) return NextResponse.json({ error: "display_name is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const allDepartmentIds = [...new Set([input.department_id, ...departmentIds].map((departmentId) => String(departmentId ?? "").trim()).filter(Boolean))];
  if (allDepartmentIds.length) {
    const { data: selectedDepartments, error: departmentError } = await supabase
      .from("departments")
      .select("id, code, name, active")
      .in("id", allDepartmentIds);
    if (departmentError) return NextResponse.json({ error: departmentError.message }, { status: 400 });
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
    department_id: input.department_id || null,
    role: toLegacyRole(appRole),
    app_role: appRole,
    active: input.active ?? true,
    login_disabled_at: input.active === false ? new Date().toISOString() : null,
    password_hash: passwordHash,
    password_updated_at: input.password ? new Date().toISOString() : undefined,
    onboarded_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from("profiles").upsert(payload).select("id, display_name, app_role, department_id, active").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (passwordHash) {
    const { error: credentialError } = await supabase.from("profile_credentials").upsert({
      profile_id: data.id,
      password_hash: passwordHash,
      password_updated_at: new Date().toISOString(),
      must_change_password: input.must_change_password ?? false
    });
    if (credentialError) return NextResponse.json({ error: credentialError.message }, { status: 400 });
  }
  const { error: deleteScopeError } = await supabase.from("department_admin_departments").delete().eq("admin_profile_id", data.id);
  if (deleteScopeError) return NextResponse.json({ error: deleteScopeError.message }, { status: 400 });
  if (appRole === "department_admin" && departmentIds.length) {
    const uniqueDepartmentIds = [...new Set(departmentIds)];
    const { error: scopeError } = await supabase.from("department_admin_departments").insert(
      uniqueDepartmentIds.map((departmentId) => ({ admin_profile_id: data.id, department_id: departmentId, created_by: guard.session?.profileId }))
    );
    if (scopeError) return NextResponse.json({ error: scopeError.message }, { status: 400 });
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
  if (profileError || !profile) return NextResponse.json({ error: profileError?.message ?? "Profile not found" }, { status: 404 });
  if (profile.app_role === "super_admin") return NextResponse.json({ error: "最高管理帳號不可透過刪除按鈕停用" }, { status: 400 });
  const timestamp = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ active: false, login_disabled_at: timestamp })
    .eq("id", id)
    .neq("app_role", "super_admin");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await supabase.from("department_admin_departments").delete().eq("admin_profile_id", id);
  await supabase.from("department_admin_employees").delete().eq("admin_profile_id", id);
  return NextResponse.json({ ok: true });
}
