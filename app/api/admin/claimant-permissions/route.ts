import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function POST(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const employeeProfileId = String(input.employee_profile_id ?? "").trim();
  const claimantIds: string[] = Array.isArray(input.claimant_profile_ids) ? input.claimant_profile_ids.map(String) : [];
  if (!employeeProfileId) return NextResponse.json({ error: "employee_profile_id is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await supabase
    .from("profiles")
    .select("id, department_id")
    .eq("id", employeeProfileId)
    .single();
  if (employeeError || !employee?.department_id) {
    return NextResponse.json({ error: employeeError?.message ?? "找不到員工部門" }, { status: 404 });
  }
  if (!guard.session!.departmentIds.includes(employee.department_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (claimantIds.length) {
    const { data: claimants, error: claimantError } = await supabase
      .from("profiles")
      .select("id, department_id")
      .in("id", claimantIds);
    if (claimantError) return NextResponse.json({ error: claimantError.message }, { status: 400 });
    if ((claimants ?? []).some((claimant) => claimant.department_id !== employee.department_id)) {
      return NextResponse.json({ error: "合單名單只能包含同部門員工" }, { status: 400 });
    }
  }

  const { error: deleteError } = await supabase.from("claimant_permissions").delete().eq("employee_profile_id", employeeProfileId);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });
  const rows = claimantIds
    .filter((id) => id !== employeeProfileId)
    .map((claimantId) => ({
      department_id: employee.department_id,
      employee_profile_id: employeeProfileId,
      claimant_profile_id: claimantId,
      created_by: guard.session!.profileId
    }));
  if (rows.length) {
    const { error } = await supabase.from("claimant_permissions").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
