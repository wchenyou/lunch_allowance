import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { appRoles } from "@/app/lib/auth/roles";
import { hashPassword, verifyPassword } from "@/app/lib/auth/password";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import type { AppRole } from "@/app/lib/domain";

export async function POST(request: Request) {
  const input = await request.json();
  const intendedRole = appRoles.includes(input.intended_role as AppRole) ? (input.intended_role as AppRole) : null;
  if (input.intended_role && !intendedRole) {
    return NextResponse.json({ error: "不支援的帳號角色" }, { status: 400 });
  }
  const guard = await requireSession(intendedRole ? [intendedRole] : ["super_admin", "department_admin", "employee"]);
  if (guard.response) return guard.response;
  const currentPassword = String(input.current_password ?? "");
  const nextPassword = String(input.next_password ?? "");
  if (!currentPassword) return NextResponse.json({ error: "請輸入目前密碼" }, { status: 400 });
  if (nextPassword.length < 8) return NextResponse.json({ error: "新密碼至少需要 8 個字元" }, { status: 400 });
  if (currentPassword === nextPassword) return NextResponse.json({ error: "新密碼不可與目前密碼相同" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  if (guard.session!.profileId === "super-admin") {
    return NextResponse.json({ error: "此最高管理員密碼由環境變數管理，請到 Vercel 更新 ADMIN_PASSWORD" }, { status: 400 });
  }
  const { data: profile, error } = await supabase.from("profiles").select("id, password_hash").eq("id", guard.session!.profileId).single();
  if (error || !profile) return NextResponse.json({ error: error?.message ?? "Profile not found" }, { status: 404 });

  const { data: credential, error: credentialError } = await supabase
    .from("profile_credentials")
    .select("password_hash")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (credentialError) return NextResponse.json({ error: credentialError.message }, { status: 400 });

  const currentPasswordOk = await verifyPassword(currentPassword, credential?.password_hash ?? profile.password_hash);
  if (!currentPasswordOk) return NextResponse.json({ error: "目前密碼錯誤" }, { status: 401 });

  const passwordHash = await hashPassword(nextPassword);
  const passwordUpdatedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("profile_credentials")
    .upsert({
      profile_id: profile.id,
      password_hash: passwordHash,
      password_updated_at: passwordUpdatedAt,
      must_change_password: false
    }, { onConflict: "profile_id" });
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });

  const { error: profileUpdateError } = await supabase
    .from("profiles")
    .update({ password_hash: passwordHash, password_updated_at: passwordUpdatedAt })
    .eq("id", profile.id);
  if (profileUpdateError) return NextResponse.json({ error: profileUpdateError.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
