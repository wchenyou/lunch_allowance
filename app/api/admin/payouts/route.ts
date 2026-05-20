import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const DEPARTMENT_SELECT = "id, code, name, active, created_at, updated_at";
const PROFILE_SELECT = "id, employee_no, display_name, email, phone, department_id, role, app_role, active, onboarded_at, created_at, updated_at";

export async function GET() {
  const guard = await requireSession(["department_admin", "super_admin"]);
  if (guard.response) return guard.response;

  const session = guard.session!;
  const supabase = createSupabaseAdminClient();
  const departmentIds = session.role === "super_admin" ? undefined : session.departmentIds;
  if (departmentIds && departmentIds.length === 0) {
    return NextResponse.json({ departments: [], profiles: [], payouts: [], session });
  }

  const departmentQuery = supabase.from("departments").select(DEPARTMENT_SELECT).order("name", { ascending: true });
  const profileQuery = supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("active", true)
    .eq("app_role", "employee")
    .is("login_disabled_at", null)
    .order("display_name", { ascending: true });

  if (departmentIds?.length) {
    departmentQuery.in("id", departmentIds);
    profileQuery.in("department_id", departmentIds);
  }

  const [departments, profiles, payoutSummary] = await Promise.all([
    departmentQuery,
    profileQuery,
    supabase.rpc("admin_payout_summary", { scoped_department_ids: departmentIds ?? null })
  ]);

  const error = departments.error ?? profiles.error ?? payoutSummary.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const payoutsByEmployee = new Map((payoutSummary.data ?? []).map((row: any) => [row.employee_id, row]));
  const payouts = (profiles.data ?? []).map((profile: any) => {
    const payout = payoutsByEmployee.get(profile.id) as any;
    return {
      employee_id: profile.id,
      employee: profile,
      actual_total: Number(payout?.actual_total ?? 0),
      subsidy_total: Number(payout?.subsidy_total ?? 0),
      receipt_count: Number(payout?.receipt_count ?? 0)
    };
  });

  return NextResponse.json({
    departments: departments.data ?? [],
    profiles: profiles.data ?? [],
    payouts,
    session
  });
}
