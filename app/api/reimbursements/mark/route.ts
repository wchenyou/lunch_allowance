import { NextResponse } from "next/server";
import { markReceipts } from "@/app/lib/storage";

export async function POST(request: Request) {
  const { receiptIds, status } = await request.json();
  if (!Array.isArray(receiptIds) || !receiptIds.length) return NextResponse.json({ error: "receiptIds required" }, { status: 400 });
  const db = await markReceipts(receiptIds, status);
  return NextResponse.json(db);
}
