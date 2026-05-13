import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { AppRole } from "@/app/lib/domain";

// 每個角色使用獨立的 Cookie，防止同一瀏覽器多分頁時 Session 互相干擾
export const SESSION_COOKIES: Record<AppRole, string> = {
  super_admin: "la_s_super",
  department_admin: "la_s_admin",
  employee: "la_s_emp",
};

// 向下相容舊 Cookie 名稱（升級時過渡期用）
export const APP_SESSION_COOKIE = "lunch_allowance_session";

export type AppSession = {
  profileId: string;
  role: AppRole;
  departmentIds: string[];
  displayName: string;
  account?: string;
};

function secret() {
  const value = process.env.APP_SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.SUPABASE_JWT_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing APP_SESSION_SECRET, ADMIN_PASSWORD, or SUPABASE_JWT_SECRET");
  }
  return "local-dev-session-secret";
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(session: AppSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined): AppSession | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppSession;
  } catch {
    return null;
  }
}

/**
 * 讀取 Session。
 * requiredRoles: 若指定，只嘗試對應角色的 Cookie，防止多角色同時登入時互相干擾。
 * 若未指定，依序嘗試所有角色的 Cookie（向下相容）。
 */
export async function getAppSession(requiredRoles?: AppRole[]): Promise<AppSession | null> {
  const cookieStore = await cookies();

  // 依指定角色順序嘗試新版角色專屬 Cookie
  const rolesToTry = requiredRoles ?? (Object.keys(SESSION_COOKIES) as AppRole[]);
  for (const role of rolesToTry) {
    const cookieName = SESSION_COOKIES[role];
    const session = decodeSession(cookieStore.get(cookieName)?.value);
    if (session) return session;
  }

  // Fallback：嘗試舊版共用 Cookie（向下相容，升級後可移除）
  if (!requiredRoles) {
    return decodeSession(cookieStore.get(APP_SESSION_COOKIE)?.value);
  }

  return null;
}

export function canAccessRole(session: AppSession | null, roles: AppRole[]) {
  return Boolean(session && roles.includes(session.role));
}
