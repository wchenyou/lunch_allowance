import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { deleteReceipt } from "@/app/lib/storage";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Receipt ID required" }, { status: 400 });

    const supabase = createSupabaseAdminClient();
    const { data: receipt, error: fetchError } = await supabase
      .from("receipts")
      .select("id, submitted_by, payer_profile_id, status")
      .eq("id", id)
      .single();

    if (fetchError || !receipt) {
      return NextResponse.json({ error: "單據不存在" }, { status: 404 });
    }

    const profileId = guard.session?.profileId;
    if (receipt.submitted_by !== profileId && receipt.payer_profile_id !== profileId) {
      return NextResponse.json({ error: "沒有權限刪除此單據" }, { status: 403 });
    }

    if (receipt.status !== "submitted" && receipt.status !== "rejected") {
      return NextResponse.json({ error: "只能刪除申請中或被退單的單據" }, { status: 400 });
    }

    await deleteReceipt(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete receipt" }, { status: 500 });
  }
}
