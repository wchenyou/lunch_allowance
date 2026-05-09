import { NextResponse } from "next/server";
import { appRoles, toAppRole } from "@/app/lib/auth/roles";
import type { AppRole } from "@/app/lib/domain";
import { hasSupabaseConfig, readDb } from "@/app/lib/storage";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = parseRole(searchParams.get("role"));

  if (!hasSupabaseConfig()) {
    const db = await readDb();
    if (role && role !== "employee") {
      return NextResponse.json({ departments: [], employees: [] });
    }
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
      .select("id, display_name, department_id, active, role, app_role")
      .eq("active", true)
      .is("login_disabled_at", null)
      .order("display_name", { ascending: true })
  ]);

  const error = departments.error ?? profiles.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const filteredProfiles = role ? (profiles.data ?? []).filter((profile) => toAppRole(profile.app_role ?? profile.role) === role) : (profiles.data ?? []);
  const departmentIds = new Set(filteredProfiles.map((profile) => profile.department_id).filter(Boolean));

  return NextResponse.json({
    departments: role ? (departments.data ?? []).filter((department) => departmentIds.has(department.id)) : departments.data ?? [],
    employees: filteredProfiles
  });
}

function parseRole(value: string | null): AppRole | null {
  return appRoles.includes(value as AppRole) ? (value as AppRole) : null;
}
