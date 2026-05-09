import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { readDb } from "@/app/lib/storage";

export async function GET() {
  const guard = await requireSession(["department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const db = await readDb();
  return NextResponse.json(db);
}
