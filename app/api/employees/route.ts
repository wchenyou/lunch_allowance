import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { upsertEmployee } from "@/app/lib/storage";

export async function POST(request: Request) {
  const guard = await requireSession(["department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  if (!input.name?.trim()) return NextResponse.json({ error: "姓名必填" }, { status: 400 });
  const db = await upsertEmployee({ ...input, name: input.name.trim() });
  return NextResponse.json(db);
}
