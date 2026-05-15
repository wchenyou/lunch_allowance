import { NextResponse } from "next/server";
import type { AppSession } from "@/app/lib/auth/session";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function requireDepartmentAdminReceiptScope(session: AppSession, input: any, receiptId?: string) {
  if (session.role !== "department_admin") return null;

  const supabase = createSupabaseAdminClient();
  if (!session.departmentIds.length) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (receiptId) {
    const { data: receipt, error } = await supabase
      .from("receipts")
      .select("id, department_id")
      .eq("id", receiptId)
      .single();
    if (error || !receipt) {
      return NextResponse.json({ error: error?.message ?? "Receipt not found" }, { status: 404 });
    }
    if (!session.departmentIds.includes(receipt.department_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const employeeIds = [
    String(input.payer_employee_id ?? input.profile_id ?? "").trim(),
    ...(Array.isArray(input.allocations) ? input.allocations.map((allocation: any) => String(allocation.employee_id ?? "").trim()) : [])
  ].filter(Boolean);
  const uniqueEmployeeIds = [...new Set(employeeIds)];
  if (!uniqueEmployeeIds.length) {
    return NextResponse.json({ error: "至少需要一位請款人" }, { status: 400 });
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, department_id, app_role, active, login_disabled_at")
    .in("id", uniqueEmployeeIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if ((profiles ?? []).length !== uniqueEmployeeIds.length) {
    return NextResponse.json({ error: "包含不存在的請款人" }, { status: 400 });
  }

  const invalid = (profiles ?? []).some(
    (profile) =>
      !profile.active ||
      profile.login_disabled_at ||
      profile.app_role !== "employee" ||
      !profile.department_id ||
      !session.departmentIds.includes(profile.department_id)
  );
  if (invalid) {
    return NextResponse.json({ error: "只能操作管轄部門內的有效員工單據" }, { status: 403 });
  }

  return null;
}

export async function requireDepartmentAdminEmployeeScope(session: AppSession, employeeId: string) {
  if (session.role !== "department_admin") return null;
  if (!employeeId || !session.departmentIds.length) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, department_id, app_role")
    .eq("id", employeeId)
    .single();
  if (error || !profile) {
    return NextResponse.json({ error: error?.message ?? "Employee not found" }, { status: 404 });
  }
  if (profile.app_role !== "employee" || !profile.department_id || !session.departmentIds.includes(profile.department_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
