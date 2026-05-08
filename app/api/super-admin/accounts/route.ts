import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { toLegacyRole, appRoles } from "@/app/lib/auth/roles";
import { hashPassword } from "@/app/lib/auth/password";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, employee_no, display_name, email, phone, department_id, role, app_role, active, password_updated_at, created_at, updated_at")
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
  if (!displayName) return NextResponse.json({ error: "display_name is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
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
  return NextResponse.json({ profile: data });
}
