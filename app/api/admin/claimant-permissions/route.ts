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

  const desired = new Set(claimantIds.filter((id) => id !== employeeProfileId));
  const { data: existingRows, error: existingError } = await supabase
    .from("claimant_permissions")
    .select("department_id, employee_profile_id, claimant_profile_id")
    .eq("employee_profile_id", employeeProfileId);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });

  const existing = new Set((existingRows ?? []).map((row) => row.claimant_profile_id));
  const removed = [...existing].filter((claimantId) => !desired.has(claimantId));
  const added = [...desired].filter((claimantId) => !existing.has(claimantId));

  if (removed.length) {
    const { error } = await supabase
      .from("claimant_permissions")
      .delete()
      .eq("employee_profile_id", employeeProfileId)
      .in("claimant_profile_id", removed);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (added.length) {
    const rows = added.map((claimantId) => ({
      department_id: employee.department_id,
      employee_profile_id: employeeProfileId,
      claimant_profile_id: claimantId,
      created_by: guard.session!.profileId
    }));
    const { error } = await supabase.from("claimant_permissions").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: claimantPermissions, error: readUpdatedError } = await supabase
    .from("claimant_permissions")
    .select("department_id, employee_profile_id, claimant_profile_id")
    .eq("employee_profile_id", employeeProfileId);
  if (readUpdatedError) return NextResponse.json({ error: readUpdatedError.message }, { status: 400 });

  return NextResponse.json({ ok: true, employee_profile_id: employeeProfileId, claimantPermissions });
}
