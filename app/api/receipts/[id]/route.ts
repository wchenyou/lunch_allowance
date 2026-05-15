import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { requireDepartmentAdminReceiptScope } from "@/app/lib/api/scope";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { deleteReceipt, upsertReceipt } from "@/app/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const { id } = await params;
  const input = await request.json();
  const scopeError = await requireDepartmentAdminReceiptScope(guard.session!, input, id);
  if (scopeError) return scopeError;
  const db = await upsertReceipt(input, id);
  return NextResponse.json(db);
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const { id } = await params;
  const supabase = createSupabaseAdminClient();
  const { data: receipt, error } = await supabase.from("receipts").select("id, department_id").eq("id", id).single();
  if (error || !receipt) return NextResponse.json({ error: error?.message ?? "Receipt not found" }, { status: 404 });
  if (!guard.session!.departmentIds.includes(receipt.department_id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = await deleteReceipt(id);
  return NextResponse.json(db);
}
