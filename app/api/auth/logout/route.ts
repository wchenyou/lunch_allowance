import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE, SESSION_COOKIES } from "@/app/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // 清除所有角色的專屬 Cookie
  for (const cookieName of Object.values(SESSION_COOKIES)) {
    response.cookies.delete(cookieName);
  }
  // 清除舊版共用 Cookie 與 legacy admin_session
  response.cookies.delete(APP_SESSION_COOKIE);
  response.cookies.delete("admin_session");
  return response;
}
