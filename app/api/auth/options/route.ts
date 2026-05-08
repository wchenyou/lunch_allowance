import { NextResponse } from "next/server";
import { hasSupabaseConfig, readDb } from "@/app/lib/storage";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  if (!hasSupabaseConfig()) {
    const db = await readDb();
    return NextResponse.json({
      departments: [{ id: "local", name: "預設部門" }],
      employees: db.employees.map((employee) => ({ id: employee.employee_id, display_name: employee.name, department_id: "local", active: employee.active }))
    });
  }

  const supabase = createSupabaseAdminClient();
  const [departments, profiles] = await Promise.all([
    supabase.from("departments").select("id, name, active").eq("active", true).order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, display_name, department_id, active, app_role")
      .eq("active", true)
      .is("login_disabled_at", null)
      .order("display_name", { ascending: true })
  ]);

  const error = departments.error ?? profiles.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    departments: departments.data ?? [],
    employees: profiles.data ?? []
  });
}
