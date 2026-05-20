import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { supabaseErrorResponse } from "../_utils";

const departmentSelect = "id, code, name, active, created_at, updated_at";
const profileSelect = "id, employee_no, display_name, email, phone, department_id, role, app_role, active, password_updated_at, login_disabled_at, created_at, updated_at";
const departmentScopeSelect = "admin_profile_id, department_id";

export async function GET() {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;

  const supabase = createSupabaseAdminClient();
  const [departments, profiles, departmentScopes] = await Promise.all([
    supabase.from("departments").select(departmentSelect).order("name", { ascending: true }),
    supabase.from("profiles").select(profileSelect).order("display_name", { ascending: true }),
    supabase.from("department_admin_departments").select(departmentScopeSelect)
  ]);

  const error = departments.error ?? profiles.error ?? departmentScopes.error;
  if (error) return supabaseErrorResponse("讀取最高權限後台資料", error, 500);

  return NextResponse.json({
    departments: departments.data ?? [],
    profiles: profiles.data ?? [],
    departmentScopes: departmentScopes.data ?? [],
    session: guard.session
  });
}
