import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { upsertReceipt } from "@/app/lib/storage";

export async function POST(request: Request) {
  const guard = await requireSession(["employee"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const profileId = String(input.profile_id ?? input.payer_employee_id ?? "").trim();
  const date = String(input.date ?? "").trim();
  const totalAmount = Number(input.total_amount);
  const allocations = Array.isArray(input.allocations)
    ? input.allocations
    : [{ employee_id: profileId, amount: totalAmount, note: input.note ?? "" }];

  if (!profileId || !date || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    return NextResponse.json({ error: "profile_id, date, and total_amount are required" }, { status: 400 });
  }
  if (guard.session!.role === "employee" && profileId !== guard.session!.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invalidAllocation = allocations.some((allocation: any) => !allocation.employee_id || Number(allocation.amount) <= 0);
  if (invalidAllocation) {
    return NextResponse.json({ error: "Each claim requires employee_id and positive amount" }, { status: 400 });
  }
  const allocationIds = [...new Set<string>(allocations.map((allocation: any) => String(allocation.employee_id)))];
  if (!allocationIds.includes(profileId)) allocationIds.unshift(profileId);
  try {
    const supabase = createSupabaseAdminClient();
    const myProfile = await supabase.from("profiles").select("department_id").eq("id", guard.session!.profileId).single();
    const myDeptId = myProfile.data?.department_id;

    const { data: myDeptAdmins } = await supabase
      .from("department_admin_departments")
      .select("admin_profile_id")
      .eq("department_id", myDeptId);
    
    const adminIds = new Set((myDeptAdmins ?? []).map(s => s.admin_profile_id));
    adminIds.add(guard.session!.profileId);
    
    const { data: allManagedScopes } = await supabase
      .from("department_admin_departments")
      .select("department_id")
      .in("admin_profile_id", Array.from(adminIds));
    
    const targetDeptIds = new Set<string>();
    if (myDeptId) targetDeptIds.add(myDeptId); 
    
    if (allManagedScopes) {
      for (const scope of allManagedScopes) {
        if (scope.department_id) targetDeptIds.add(scope.department_id);
      }
    }

    console.log("[Receipt POST] profileId:", guard.session!.profileId, "myDeptId:", myDeptId, "targetDeptIds:", Array.from(targetDeptIds));

    const { data: validProfiles } = await supabase.from("profiles").select("id").in("department_id", Array.from(targetDeptIds));
    const allowedIds = new Set([guard.session!.profileId, ...(validProfiles ?? []).map(p => p.id)]);

    if (allocationIds.some((id) => !allowedIds.has(id))) {
      return NextResponse.json({ error: "只能選擇行政維護允許的請款人" }, { status: 403 });
    }

    const { data: existingClaims, error: claimError } = await supabase
      .from("receipt_claims")
      .select("receipt_id, profile_id, receipts(status)")
      .in("profile_id", allocationIds)
      .eq("claim_date", date);
    if (claimError) throw claimError;
    const counts = new Map<string, Set<string>>();
    for (const rawClaim of existingClaims ?? []) {
      const claim = rawClaim as any;
      const status = Array.isArray(claim.receipts) ? claim.receipts[0]?.status : claim.receipts?.status;
      if (status === "rejected" || status === "void") continue;
      const receiptIds = counts.get(claim.profile_id) ?? new Set<string>();
      receiptIds.add(claim.receipt_id);
      counts.set(claim.profile_id, receiptIds);
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
    const receipt = db.receipts.find((item) => item.date === date && item.payer_employee_id === profileId && item.total_amount === totalAmount) ?? db.receipts[0];
    return NextResponse.json({ ...db, receipt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit receipt" }, { status: 500 });
  }
}
