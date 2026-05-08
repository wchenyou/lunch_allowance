import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/options", "/api/supabase/health"];
const ROLE_COOKIE = "lunch_allowance_session";
const AUTH_ENFORCEMENT_ENABLED = true;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path)) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (!AUTH_ENFORCEMENT_ENABLED) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(ROLE_COOKIE)?.value || request.cookies.get("admin_session")?.value === "ok");
  if (!hasSession) {
    if (pathname.startsWith("/api")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};
