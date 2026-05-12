import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { hashPassword, verifyPassword } from "@/app/lib/auth/password";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function POST(request: Request) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
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
