import { NextResponse } from "next/server";
import { appRoles, toAppRole } from "@/app/lib/auth/roles";
import { APP_SESSION_COOKIE, encodeSession } from "@/app/lib/auth/session";
import { verifyPassword } from "@/app/lib/auth/password";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import type { AppRole } from "@/app/lib/domain";

export async function POST(request: Request) {
  const input = await request.json();
  const password = String(input.password ?? "");
  const profileId = String(input.profile_id ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();
  const intendedRole = parseIntendedRole(input.intended_role);

  if (input.intended_role && !intendedRole) {
    return NextResponse.json({ error: "不支援的登入角色" }, { status: 400 });
  }

  if (profileId) {
    return loginWithProfilePassword(profileId, departmentId, password, intendedRole);
  }

  if (intendedRole && intendedRole !== "super_admin") {
    return NextResponse.json({ error: "此入口不接受最高管理密碼登入" }, { status: 401 });
  }
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured" }, { status: 500 });
  }
  if (!password || password !== expected) {
    return NextResponse.json({ error: "管理密碼錯誤" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, role: "super_admin", redirect_to: "/super-admin" });
  response.cookies.set(APP_SESSION_COOKIE, encodeSession({ profileId: "super-admin", role: "super_admin", departmentIds: [], displayName: "系統管理員" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  response.cookies.set("admin_session", "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return response;
}

function parseIntendedRole(value: unknown): AppRole | null {
  return appRoles.includes(value as AppRole) ? (value as AppRole) : null;
}

async function loginWithProfilePassword(profileId: string, departmentId: string, password: string, intendedRole: AppRole | null) {
  if (!departmentId && intendedRole !== "super_admin") {
    return NextResponse.json({ error: "請選擇部門" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "Supabase service role env is required for employee login" }, { status: 501 });
  }

  let query = supabase
    .from("profiles")
    .select("id, display_name, department_id, role, app_role, active, password_hash, login_disabled_at")
    .eq("id", profileId);

  if (departmentId) {
    query = query.eq("department_id", departmentId);
  }

  const { data: profile, error } = await query.single();

  if (error || !profile || !profile.active || profile.login_disabled_at) {
    return NextResponse.json({ error: "帳號不存在或已停用" }, { status: 401 });
  }

  const { data: credential } = await supabase
    .from("profile_credentials")
    .select("password_hash, must_change_password")
    .eq("profile_id", profile.id)
    .maybeSingle();
  const ok = await verifyPassword(password, credential?.password_hash ?? profile.password_hash);
  if (!ok) return NextResponse.json({ error: "密碼錯誤" }, { status: 401 });

  const role = toAppRole(profile.app_role ?? profile.role);
  if (intendedRole && role !== intendedRole) {
    return NextResponse.json({ error: "此登入入口不接受該帳號角色" }, { status: 401 });
  }

  const { data: scopes } = await supabase.from("department_admin_departments").select("department_id").eq("admin_profile_id", profile.id);
  const departmentIds = role === "department_admin" ? (scopes ?? []).map((scope) => scope.department_id) : profile.department_id ? [profile.department_id] : [];
  await supabase.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", profile.id);

  const redirectTo = role === "super_admin" ? "/super-admin" : role === "department_admin" ? "/admin" : "/employee";
  const response = NextResponse.json({ ok: true, role, redirect_to: redirectTo, must_change_password: credential?.must_change_password ?? false });
  response.cookies.set(APP_SESSION_COOKIE, encodeSession({ profileId: profile.id, role, departmentIds, displayName: profile.display_name }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return response;
}
