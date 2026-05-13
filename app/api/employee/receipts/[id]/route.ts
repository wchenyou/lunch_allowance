import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { deleteReceipt, readDb } from "@/app/lib/storage";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Receipt ID required" }, { status: 400 });

    const db = await readDb();
    const receipt = db.receipts.find((r) => r.receipt_id === id);
    
    if (!receipt) {
      return NextResponse.json({ error: "單據不存在" }, { status: 404 });
    }

    if (receipt.submitted_by !== guard.session?.profileId && receipt.payer_employee_id !== guard.session?.profileId) {
      return NextResponse.json({ error: "沒有權限刪除此單據" }, { status: 403 });
    }

    if (receipt.reimbursement_status !== "pending" && receipt.reimbursement_status !== "rejected") {
      return NextResponse.json({ error: "只能刪除申請中或被退單的單據" }, { status: 400 });
    }

    await deleteReceipt(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete receipt" }, { status: 500 });
  }
}
