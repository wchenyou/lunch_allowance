import { NextResponse } from "next/server";
import { canAccessRole, getAppSession } from "@/app/lib/auth/session";
import type { AppRole } from "@/app/lib/domain";

export async function requireSession(roles: AppRole[]) {
  const session = await getAppSession(roles);
  if (!canAccessRole(session, roles)) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, response: null };
}
