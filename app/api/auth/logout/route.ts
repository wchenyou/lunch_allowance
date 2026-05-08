import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE } from "@/app/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("admin_session");
  response.cookies.delete(APP_SESSION_COOKIE);
  return response;
}
