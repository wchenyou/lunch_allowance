import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { appRoles } from "@/app/lib/auth/roles";
import { hashPassword } from "@/app/lib/auth/password";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import type { AppRole } from "@/app/lib/domain";

export async function POST(request: Request) {
  const input = await request.json();
  const intendedRole = appRoles.includes(input.intended_role as AppRole) ? (input.intended_role as AppRole) : null;
  const guard = await requireSession(intendedRole ? [intendedRole] : ["super_admin", "department_admin", "employee"]);
  if (guard.response) return guard.response;
  const nextPassword = String(input.next_password ?? "");
  if (nextPassword.length < 8) return NextResponse.json({ error: "新密碼至少需要 8 個字元" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: profile, error } = await supabase.from("profiles").select("id, password_hash").eq("id", guard.session!.profileId).single();
  if (error || !profile) return NextResponse.json({ error: error?.message ?? "Profile not found" }, { status: 404 });

  const passwordHash = await hashPassword(nextPassword);
  const { error: updateError } = await supabase
    .from("profile_credentials")
    .upsert({
      profile_id: profile.id,
      password_hash: passwordHash,
      password_updated_at: new Date().toISOString(),
      must_change_password: false
    });
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });
  await supabase.from("profiles").update({ password_hash: passwordHash, password_updated_at: new Date().toISOString() }).eq("id", profile.id);
  return NextResponse.json({ ok: true });
}
