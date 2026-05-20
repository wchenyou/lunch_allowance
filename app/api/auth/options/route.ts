import { NextResponse } from "next/server";
import { appRoles } from "@/app/lib/auth/roles";
import { visibleDepartments } from "@/app/lib/departments";
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
  const [departments, employeeDepartments] = await Promise.all([
    supabase.from("departments").select("id, name, active").eq("active", true).order("name", { ascending: true }),
    supabase.rpc("active_employee_department_ids")
  ]);

  const error = departments.error ?? employeeDepartments.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const departmentIds = new Set((employeeDepartments.data ?? []).map((row: { department_id: string | null }) => row.department_id).filter(Boolean));

  return NextResponse.json({
    departments: visibleDepartments(departments.data ?? []).filter((department) => departmentIds.has(department.id))
  });
}

function parseRole(value: string | null): AppRole | null {
  return appRoles.includes(value as AppRole) ? (value as AppRole) : null;
}
