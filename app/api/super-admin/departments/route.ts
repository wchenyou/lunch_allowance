import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("departments").select("*").order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ departments: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const code = String(input.code ?? "").trim();
  const name = String(input.name ?? "").trim();
  if (!code || !name) return NextResponse.json({ error: "code and name are required" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("departments")
    .upsert({ id: input.id || undefined, code, name, active: input.active ?? true })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ department: data });
}
