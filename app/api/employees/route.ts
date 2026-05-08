import { NextResponse } from "next/server";
import { upsertEmployee } from "@/app/lib/storage";

export async function POST(request: Request) {
  const input = await request.json();
  if (!input.name?.trim()) return NextResponse.json({ error: "姓名必填" }, { status: 400 });
  const db = await upsertEmployee({ ...input, name: input.name.trim() });
  return NextResponse.json(db);
}
