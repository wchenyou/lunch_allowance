import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import type { AppRole } from "@/app/lib/domain";

const roles: AppRole[] = ["admin", "hr", "manager", "employee"];

export async function POST(request: Request) {
  const input = await request.json();
  const email = String(input.email ?? "").trim().toLowerCase();
  const displayName = String(input.display_name ?? "").trim();
  const role = roles.includes(input.role) ? input.role : "employee";

  if (!email || !displayName) {
    return NextResponse.json({ error: "email and display_name are required" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "Supabase service role env is required to create accounts" }, { status: 501 });
  }
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password: input.password ? String(input.password) : undefined,
    email_confirm: true,
    user_metadata: { display_name: displayName }
  });

  if (userError || !userData.user) {
    return NextResponse.json({ error: userError?.message ?? "Failed to create auth user" }, { status: 400 });
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userData.user.id,
    email,
    display_name: displayName,
    employee_no: input.employee_no ?? null,
    department_id: input.department_id ?? null,
    role,
    active: input.active ?? true,
    onboarded_at: new Date().toISOString()
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ id: userData.user.id, email, display_name: displayName, role });
}
