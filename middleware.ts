import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/options", "/api/supabase/health"];
const ROLE_COOKIE = "lunch_allowance_session";
const AUTH_ENFORCEMENT_ENABLED = true;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path)) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (!AUTH_ENFORCEMENT_ENABLED) {
    return NextResponse.next();
  }

  const session = await decodeSession(request.cookies.get(ROLE_COOKIE)?.value);
  const hasLegacyAdminSession = request.cookies.get("admin_session")?.value === "ok";
  if (!session && !hasLegacyAdminSession) {
    if (pathname.startsWith("/api")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (pathname.startsWith("/employee")) return NextResponse.redirect(new URL("/login/employee", request.url));
    if (pathname.startsWith("/admin")) return NextResponse.redirect(new URL("/login/admin", request.url));
    if (pathname.startsWith("/super-admin")) return NextResponse.redirect(new URL("/login/super-admin", request.url));
    return NextResponse.redirect(new URL("/login/employee", request.url));
  }

  const role = session?.role ?? (hasLegacyAdminSession ? "super_admin" : null);
  if (pathname.startsWith("/super-admin") && role !== "super_admin") return deny(request, "/login/super-admin");
  if ((pathname === "/" || pathname.startsWith("/admin")) && role !== "department_admin") return deny(request, "/login/admin");
  if (pathname.startsWith("/employee") && role !== "employee") return deny(request, "/login/employee");

  if (pathname.startsWith("/api/super-admin") && role !== "super_admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((pathname.startsWith("/api/admin") || pathname.startsWith("/api/reimbursements") || pathname.startsWith("/api/receipts") || pathname.startsWith("/api/employees")) && role !== "department_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (pathname.startsWith("/api/bootstrap") && role !== "employee" && role !== "department_admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pathname.startsWith("/api/employee") && role !== "employee") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.next();
}

function deny(request: NextRequest, loginPath: string) {
  if (request.nextUrl.pathname.startsWith("/api")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL(loginPath, request.url));
}

async function decodeSession(value: string | undefined): Promise<{ role?: string } | null> {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload);
  if (signature !== expected) return null;
  try {
    return JSON.parse(base64UrlDecode(payload)) as { role?: string };
  } catch {
    return null;
  }
}

function sessionSecret() {
  return process.env.APP_SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.SUPABASE_JWT_SECRET || "local-dev-session-secret";
}

async function sign(payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sessionSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(signature);
}

function base64UrlEncode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};
