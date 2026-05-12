import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { AppRole } from "@/app/lib/domain";

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

export async function getAppSession() {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(APP_SESSION_COOKIE)?.value);
}

export function canAccessRole(session: AppSession | null, roles: AppRole[]) {
  return Boolean(session && roles.includes(session.role));
}
