import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { password } = await request.json();
  // Future auth: ADMIN_PASSWORD should be required again when middleware auth
  // enforcement is enabled. During the temporary no-login phase, keep the API
  // usable with the local default so the session cookie flow remains testable.
  const expected = process.env.ADMIN_PASSWORD || "admin";
  if (!expected) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured" }, { status: 500 });
  }
  if (!password || password !== expected) {
    return NextResponse.json({ error: "管理密碼錯誤" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("admin_session", "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return response;
}
