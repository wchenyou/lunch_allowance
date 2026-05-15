import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { upsertReceipt } from "@/app/lib/storage";

export async function POST(request: Request) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const profileId = String(input.profile_id ?? input.payer_employee_id ?? "").trim();
  const date = String(input.date ?? "").trim();
  const totalAmount = Number(input.total_amount);
  const allocations = Array.isArray(input.allocations)
    ? input.allocations.map((a: any) => ({ ...a, amount: Math.round(Number(a.amount) * 100) / 100 }))
    : [{ employee_id: profileId, amount: Math.round(totalAmount * 100) / 100, note: input.note ?? "" }];

  if (!profileId || !date || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    return NextResponse.json({ error: "profile_id, date, and total_amount are required" }, { status: 400 });
  }
  if (guard.session!.role === "employee" && profileId !== guard.session!.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const totalClaimed = allocations.reduce((sum: number, a: any) => sum + Number(a.amount), 0);
  if (totalClaimed > totalAmount) {
    return NextResponse.json({ error: "請款總額不能超過收據總額" }, { status: 400 });
  }

  const invalidAllocation = allocations.some((allocation: any) => !allocation.employee_id || Number(allocation.amount) <= 0);
  if (invalidAllocation) {
    return NextResponse.json({ error: "Each claim requires employee_id and positive amount" }, { status: 400 });
  }
  const allocationIds = [...new Set<string>(allocations.map((allocation: any) => String(allocation.employee_id)))];
  if (!allocationIds.includes(profileId)) allocationIds.unshift(profileId);
  try {
    const supabase = createSupabaseAdminClient();
    const [submitterProfile, existingClaimsResult] = await Promise.all([
      supabase.from("profiles").select("department_id").eq("id", profileId).single(),
      supabase
        .from("receipt_claims")
        .select("receipt_id, profile_id")
        .in("profile_id", allocationIds)
        .eq("claim_date", date)
    ]);
    if (submitterProfile.error) throw submitterProfile.error;
    if (existingClaimsResult.error) throw existingClaimsResult.error;

    if (guard.session!.role === "department_admin") {
      const submitterDeptId = submitterProfile.data?.department_id;
      if (!submitterDeptId || !guard.session!.departmentIds.includes(submitterDeptId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    let allowedIds = new Set<string>([profileId]);
    if (guard.session!.role === "super_admin") {
      const { data: employees, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("active", true)
        .eq("app_role", "employee");
      if (error) throw error;
      allowedIds = new Set((employees ?? []).map((employee) => employee.id));
    } else if (guard.session!.role === "department_admin") {
      const { data: employees, error } = guard.session!.departmentIds.length
        ? await supabase
            .from("profiles")
            .select("id")
            .in("department_id", guard.session!.departmentIds)
            .eq("active", true)
            .eq("app_role", "employee")
        : { data: [], error: null };
      if (error) throw error;
      allowedIds = new Set((employees ?? []).map((employee) => employee.id));
    } else {
      const submitterDeptId = submitterProfile.data?.department_id;
      const targetDeptIds = new Set<string>();
      if (submitterDeptId) targetDeptIds.add(submitterDeptId);

      const { data: sharedAdmins, error: sharedAdminsError } = submitterDeptId
        ? await supabase
            .from("department_admin_departments")
            .select("admin_profile_id")
            .eq("department_id", submitterDeptId)
        : { data: [], error: null };
      if (sharedAdminsError) throw sharedAdminsError;

      const adminIds = [...new Set((sharedAdmins ?? []).map((scope) => scope.admin_profile_id))];
      const { data: managedScopes, error: managedScopesError } = adminIds.length
        ? await supabase
            .from("department_admin_departments")
            .select("department_id")
            .in("admin_profile_id", adminIds)
        : { data: [], error: null };
      if (managedScopesError) throw managedScopesError;

      for (const scope of managedScopes ?? []) {
        if (scope.department_id) targetDeptIds.add(scope.department_id);
      }

      const { data: employees, error } = targetDeptIds.size
        ? await supabase
            .from("profiles")
            .select("id")
            .in("department_id", [...targetDeptIds])
            .eq("active", true)
            .eq("app_role", "employee")
        : { data: [], error: null };
      if (error) throw error;
      allowedIds = new Set((employees ?? []).map((employee) => employee.id));
    }

    if (allocationIds.some((id) => !allowedIds.has(id))) {
      return NextResponse.json({ error: "只能選擇同一位部門行政管轄範圍內的請款人" }, { status: 403 });
    }

    // 分開查詢收據狀態，避免巢狀 join 失敗導致整個驗證中斷
    const existingClaims = existingClaimsResult.data ?? [];
    const existingReceiptIds = [...new Set((existingClaims ?? []).map((c: any) => c.receipt_id))];
    const { data: receiptStatuses } = existingReceiptIds.length
      ? await supabase.from("receipts").select("id, status").in("id", existingReceiptIds)
      : { data: [] };
    const rejectedIds = new Set(
      (receiptStatuses ?? []).filter((r: any) => r.status === "rejected" || r.status === "void").map((r: any) => r.id)
    );

    const counts = new Map<string, Set<string>>();
    for (const claim of existingClaims ?? []) {
      const c = claim as any;
      if (rejectedIds.has(c.receipt_id)) continue;
      const receiptIds = counts.get(c.profile_id) ?? new Set<string>();
      receiptIds.add(c.receipt_id);
      counts.set(c.profile_id, receiptIds);
    }
    const blockedId = allocationIds.find((id) => (counts.get(id)?.size ?? 0) >= 2);
    if (blockedId) {
      return NextResponse.json({ error: "同一位員工同一天最多只能送出兩張單據" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法驗證請款權限" }, { status: 500 });
  }

  try {
    const db = await upsertReceipt({
      date,
      payer_employee_id: profileId,
      merchant: input.merchant ?? "",
      total_amount: totalAmount,
      receipt_no: input.receipt_no ?? "",
      note: input.note ?? "",
      category: input.category ?? "餐費補助",
      reimbursement_status: "pending",
      allocations
    });
    const receipt =
      db.receipts.find((item) => item.date === date && item.payer_employee_id === profileId && item.total_amount === totalAmount) ??
      db.receipts[0];
    const receiptAllocations = receipt
      ? db.allocations.filter((allocation: any) => allocation.receipt_id === receipt.receipt_id)
      : [];
    return NextResponse.json({ receipt, allocations: receiptAllocations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit receipt";
    const status = message.includes("最多只能送出兩張") || message.includes("請款總額") || message.includes("Each claim") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
