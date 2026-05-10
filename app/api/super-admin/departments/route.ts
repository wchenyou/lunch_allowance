import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { isSystemDepartment } from "@/app/lib/departments";
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
  if (isSystemDepartment({ code, name })) return NextResponse.json({ error: "系統管理不可建立為一般部門" }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("departments")
    .upsert({ id: input.id || undefined, code, name, active: input.active ?? true })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ department: data });
}

export async function DELETE(request: Request) {
  const guard = await requireSession(["super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const id = String(input.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: department, error: findError } = await supabase.from("departments").select("id, code, name").eq("id", id).single();
  if (findError || !department) return NextResponse.json({ error: findError?.message ?? "Department not found" }, { status: 404 });
  if (isSystemDepartment(department)) return NextResponse.json({ error: "系統管理部門不可透過 UI 停用" }, { status: 400 });

  const { error } = await supabase.from("departments").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
