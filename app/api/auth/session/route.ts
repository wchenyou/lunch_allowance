import { NextResponse } from "next/server";
import { getAppSession } from "@/app/lib/auth/session";

export async function GET() {
  const session = await getAppSession();
  return NextResponse.json({ authenticated: Boolean(session), session });
}
