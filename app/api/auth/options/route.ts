import { NextResponse } from "next/server";
import { appRoles, toAppRole } from "@/app/lib/auth/roles";
import type { AppRole } from "@/app/lib/domain";
import { hasSupabaseConfig } from "@/app/lib/storage";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = parseRole(searchParams.get("role"));

  if (role && role !== "employee") {
    return NextResponse.json({ departments: [] });
  }

  if (!hasSupabaseConfig()) {
    return NextResponse.json({
      departments: role === "employee" || !role ? [{ id: "local", name: "預設部門", active: true }] : []
    });
  }

  const supabase = createSupabaseAdminClient();
  const [departments, profiles] = await Promise.all([
    supabase.from("departments").select("id, name, active").eq("active", true).order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("department_id, role, app_role")
      .eq("active", true)
      .is("login_disabled_at", null)
  ]);

  const error = departments.error ?? profiles.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const filteredProfiles = (profiles.data ?? []).filter((profile) => toAppRole(profile.app_role ?? profile.role) === "employee");
  const departmentIds = new Set(filteredProfiles.map((profile) => profile.department_id).filter(Boolean));

  return NextResponse.json({
    departments: (departments.data ?? []).filter((department) => departmentIds.has(department.id))
  });
}

function parseRole(value: string | null): AppRole | null {
  return appRoles.includes(value as AppRole) ? (value as AppRole) : null;
}
