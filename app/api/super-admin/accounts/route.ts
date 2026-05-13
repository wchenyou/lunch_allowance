import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { toLegacyRole, appRoles } from "@/app/lib/auth/roles";
import { hashPassword } from "@/app/lib/auth/password";
import { isSystemDepartment } from "@/app/lib/departments";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { normalizeIds, supabaseErrorResponse } from "../_utils";

type ProfilePayload = {
  id?: string;
  employee_no: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  department_id: string | null;
  role: ReturnType<typeof toLegacyRole>;
  app_role: (typeof appRoles)[number];
  active: boolean;
  login_disabled_at: string | null;
  onboarded_at: string;
  password_hash?: string;
  password_updated_at?: string;
};

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
  const id = String(input.id ?? "").trim();
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
  const payload: ProfilePayload = {
    id: id || undefined,
    employee_no: String(input.employee_no ?? "").trim() || null,
    display_name: displayName,
    email: String(input.email ?? "").trim().toLowerCase() || null,
    phone: String(input.phone ?? "").trim() || null,
    department_id: primaryDepartmentId || null,
    role: toLegacyRole(appRole),
    app_role: appRole,
    active: input.active ?? true,
    login_disabled_at: input.active === false ? new Date().toISOString() : null,
    onboarded_at: new Date().toISOString()
  };
  if (passwordHash) {
    payload.password_hash = passwordHash;
    payload.password_updated_at = new Date().toISOString();
  }

  const profileWrite = id
    ? await supabase.from("profiles").update(payload).eq("id", id).select("id, display_name, app_role, department_id, active").single()
    : await supabase.from("profiles").insert(payload).select("id, display_name, app_role, department_id, active").single();
  const { data, error } = profileWrite;
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
  if (id === guard.session?.profileId) return NextResponse.json({ error: "不可刪除目前登入帳號" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id, app_role").eq("id", id).single();
  if (profileError) return supabaseErrorResponse("讀取帳號資料", profileError, 404);
  if (!profile) return NextResponse.json({ error: "找不到帳號" }, { status: 404 });
  if (profile.app_role === "super_admin") return NextResponse.json({ error: "最高管理帳號不可透過此按鈕刪除，請先修改其角色" }, { status: 400 });

  // Plan A: check for related data before hard deleting
  const [submittedResult, claimsResult] = await Promise.all([
    supabase.from("receipts").select("id", { count: "exact", head: true }).eq("submitted_by", id),
    supabase.from("receipt_claims").select("id", { count: "exact", head: true }).eq("profile_id", id)
  ]);
  const submittedCount = submittedResult.count ?? 0;
  const claimsCount = claimsResult.count ?? 0;

  if (submittedCount > 0 || claimsCount > 0) {
    const parts: string[] = [];
    if (submittedCount > 0) parts.push(`${submittedCount} 筆提交的收據`);
    if (claimsCount > 0) parts.push(`${claimsCount} 筆請款紀錄`);
    return NextResponse.json(
      { error: `無法刪除：此帳號仍有 ${parts.join(" 及 ")}，請先處理相關資料` },
      { status: 409 }
    );
  }

  // Clean up scopes first, then hard delete
  await Promise.all([
    supabase.from("department_admin_departments").delete().eq("admin_profile_id", id),
    supabase.from("department_admin_employees").delete().eq("admin_profile_id", id),
    supabase.from("profile_credentials").delete().eq("profile_id", id)
  ]);
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) return supabaseErrorResponse("刪除帳號", error);
  return NextResponse.json({ ok: true });
}
