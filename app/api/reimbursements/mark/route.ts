import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { markReceipts } from "@/app/lib/storage";

export async function POST(request: Request) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const { receiptIds, status } = await request.json();
  if (!Array.isArray(receiptIds) || !receiptIds.length) return NextResponse.json({ error: "receiptIds required" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { data: receipts, error } = await supabase.from("receipts").select("id, department_id").in("id", receiptIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if ((receipts ?? []).length !== receiptIds.length || (receipts ?? []).some((receipt) => !guard.session!.departmentIds.includes(receipt.department_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const db = await markReceipts(receiptIds, status);
  return NextResponse.json(db);
}
