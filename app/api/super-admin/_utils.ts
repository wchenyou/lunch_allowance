import { NextResponse } from "next/server";

type SupabaseLikeError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export function normalizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

export function supabaseErrorResponse(action: string, error: SupabaseLikeError, status = 400) {
  console.error(`[super-admin] ${action} failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint
  });

  return NextResponse.json({ error: `${action}失敗，請稍後再試或聯絡系統管理員` }, { status });
}
