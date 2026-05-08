import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];
const AUTH_ENFORCEMENT_ENABLED = false;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path)) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Future auth: keep the admin_session cookie flow available, but Aaron wants
  // production to be usable without login for now. Flip this flag when role
  // checks for employee/admin surfaces are ready.
  if (!AUTH_ENFORCEMENT_ENABLED) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.get("admin_session")?.value === "ok";
  if (!hasSession) {
    if (pathname.startsWith("/api")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};
