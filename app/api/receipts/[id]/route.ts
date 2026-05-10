import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { deleteReceipt, upsertReceipt } from "@/app/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const { id } = await params;
  const input = await request.json();
  const db = await upsertReceipt(input, id);
  return NextResponse.json(db);
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const { id } = await params;
  const db = await deleteReceipt(id);
  return NextResponse.json(db);
}
