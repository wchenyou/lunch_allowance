import { NextResponse } from "next/server";
import { toAppRole } from "@/app/lib/auth/roles";
import { APP_SESSION_COOKIE, encodeSession } from "@/app/lib/auth/session";
import { verifyPassword } from "@/app/lib/auth/password";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function POST(request: Request) {
  const input = await request.json();
  const password = String(input.password ?? "");
  const profileId = String(input.profile_id ?? "").trim();
  const departmentId = String(input.department_id ?? "").trim();

  if (profileId && departmentId) {
    return loginWithProfilePassword(profileId, departmentId, password);
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

async function loginWithProfilePassword(profileId: string, departmentId: string, password: string) {
  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "Supabase service role env is required for employee login" }, { status: 501 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, display_name, department_id, role, app_role, active, password_hash, login_disabled_at")
    .eq("id", profileId)
    .eq("department_id", departmentId)
    .single();

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
