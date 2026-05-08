import { NextResponse } from "next/server";
import { buildReimbursementReport } from "@/app/lib/calculations";
import { readDb } from "@/app/lib/storage";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const db = await readDb();
  return NextResponse.json(buildReimbursementReport(db, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? ""));
}
