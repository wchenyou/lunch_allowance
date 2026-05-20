import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/app/lib/storage";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, mode: "fallback", error: "Supabase env is not configured" }, { status: 200 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("profiles").select("id").limit(1);

  if (error) {
    return NextResponse.json({ ok: false, mode: "supabase", error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mode: "supabase" });
}
