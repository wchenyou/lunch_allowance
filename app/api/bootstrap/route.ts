import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { calculateDailyClaimSubsidies, normalizeStatus } from "@/app/lib/calculations";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { readDb } from "@/app/lib/storage";

export async function GET() {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  
  const db = await readDb();
  const currentProfileId = guard.session?.profileId;
  if (!currentProfileId) return NextResponse.json({ error: "No profile" }, { status: 400 });

  const currentEmployee = db.employees.find((e) => e.employee_id === currentProfileId);
  if (!currentEmployee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const ownReceipts = db.receipts.filter((receipt) => receipt.payer_employee_id === currentProfileId || receipt.submitted_by === currentProfileId);
  const ownAllocations = db.allocations.filter((allocation) => allocation.employee_id === currentProfileId);
  
  let allowedClaimants = [currentEmployee];
  let signedAttachments = (db.attachments ?? []).filter((attachment) => ownReceipts.some((receipt) => receipt.receipt_id === attachment.receipt_id));
  let allowedDepartments: any[] = [];
  
  try {
    const supabase = createSupabaseAdminClient();
    
    const targetDeptIds = new Set<string>();
    if (currentEmployee.department_id) targetDeptIds.add(currentEmployee.department_id);
    
    if (guard.session?.role === "super_admin") {
      allowedClaimants = db.employees.filter((e) => e.active);
      const { data: allDepts } = await supabase.from("departments").select("*").eq("active", true);
      allowedDepartments = allDepts ?? [];
    } else {
      // 1. 查找誰是「管理我所屬部門」的行政 (例如 Biz 管理 Aaron 所屬的「商務合作處」)
      const { data: myDeptAdmins } = await supabase
        .from("department_admin_departments")
        .select("admin_profile_id")
        .eq("department_id", currentEmployee.department_id);
      
      const adminIds = new Set((myDeptAdmins ?? []).map(s => s.admin_profile_id));
      adminIds.add(currentProfileId); // 也包含自己
      
      // 2. 查找這些行政「所管轄的所有部門」 (例如 Biz 管轄「商務合作處」和「推廣開發處」)
      const { data: allManagedScopes } = await supabase
        .from("department_admin_departments")
        .select("department_id")
        .in("admin_profile_id", Array.from(adminIds));
      
      // 3. 彙整目標部門 ID
      if (currentEmployee.department_id) targetDeptIds.add(currentEmployee.department_id);
      if (allManagedScopes) {
        for (const scope of allManagedScopes) {
          if (scope.department_id) targetDeptIds.add(scope.department_id);
        }
      }
      
      allowedClaimants = db.employees.filter((e) => e.active && e.department_id != null && targetDeptIds.has(e.department_id));
      
      // 獲取所有目標部門內的員工，而不僅僅是 db.employees 中已載入的部分（如果是快取的話）
      // 確保跨部門的人選能正確列出
      const targetIdsArray = Array.from(targetDeptIds);
      if (targetIdsArray.length > 0) {
        const { data: targetProfiles } = await supabase
          .from("profiles")
          .select("*, departments!profiles_department_id_fkey(name)")
          .in("department_id", targetIdsArray)
          .eq("active", true)
          .order("display_name", { ascending: true });
          
        if (targetProfiles) {
          // 將 profiles 轉化為 Employee 格式
          allowedClaimants = targetProfiles.map((p: any) => ({
            employee_id: p.id,
            name: p.display_name,
            active: p.active,
            department_id: p.department_id,
            department_name: p.departments?.name ?? null,
            note: [p.employee_no, p.email].filter(Boolean).join(" / "),
            created_at: p.created_at,
            updated_at: p.updated_at
          }));
        }

        const { data: targetDepts } = await supabase.from("departments").select("*").in("id", targetIdsArray).eq("active", true);
        allowedDepartments = targetDepts ?? [];
      }
    }

    const bucket = process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
    if (signedAttachments.length > 0) {
      const paths = signedAttachments.map((a) => a.object_path);
      const { data: signedUrlsData } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
      if (signedUrlsData) {
        const urlMap = new Map(signedUrlsData.map((d) => [d.path, d.signedUrl]));
        signedAttachments = signedAttachments.map((attachment) => ({
          ...attachment,
          signed_url: urlMap.get(attachment.object_path) ?? undefined
        }));
      }
    }
  } catch (error) {
    console.error(error);
  }

  const paidReceiptIds = new Set(ownReceipts.filter((receipt) => normalizeStatus(receipt.reimbursement_status) === "paid").map((receipt) => receipt.receipt_id));
  const submittedTotal = ownReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0);
  const paidTotal = ownAllocations
    .filter((allocation) => paidReceiptIds.has(allocation.receipt_id))
    .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
    
  const pendingReceipts = ownReceipts.filter((receipt) => normalizeStatus(receipt.reimbursement_status) !== "paid" && normalizeStatus(receipt.reimbursement_status) !== "rejected");
  const pendingCount = pendingReceipts.length;
  
  // 「單據總金額」：所有待處理單據的面額總加
  const pendingTotalAmount = pendingReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0);
  
  // 「可請款總金額」：根據每天每人 150 元上限計算後的補助總額
  const pendingReceiptIds = new Set(pendingReceipts.map(r => r.receipt_id));
  
  // 重新對所有 Pending 單據進行一次每日上限計算
  const allPendingClaims = ownAllocations
    .filter(a => pendingReceiptIds.has(a.receipt_id))
    .map(a => ({
      id: a.allocation_id,
      profileId: a.employee_id,
      claimDate: a.date,
      claimedAmount: a.amount,
      createdAt: a.created_at
    }));
  
  const calculatedPendingSubsidies = calculateDailyClaimSubsidies(allPendingClaims);
  const totalSubsidy = calculatedPendingSubsidies.reduce((sum, s) => sum + s.subsidyAmount, 0);
    
  return NextResponse.json({
    employees: [currentEmployee],
    allowedClaimants,
    departments: allowedDepartments,
    receipts: ownReceipts,
    allocations: ownAllocations,
    attachments: signedAttachments,
    summary: {
      submittedTotal,
      paidTotal,
      unpaidTotal: Math.max(0, submittedTotal - paidTotal),
      pendingCount,
      pendingTotalAmount,
      pendingClaimableAmount: totalSubsidy
    }
  });
}
