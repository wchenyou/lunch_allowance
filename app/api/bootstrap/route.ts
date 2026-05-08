import { NextResponse } from "next/server";
import { readDb } from "@/app/lib/storage";

export async function GET() {
  const db = await readDb();
  return NextResponse.json(db);
}
