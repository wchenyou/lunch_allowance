import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  const guard = await requireSession(["department_admin"]);
  if (guard.response) return guard.response;
  const session = guard.session!;
  const supabase = createSupabaseAdminClient();
  const departmentIds = session.role === "super_admin" ? undefined : session.departmentIds;
  if (departmentIds && departmentIds.length === 0) {
    return NextResponse.json({ departments: [], profiles: [], receipts: [] });
  }

  const departmentQuery = supabase.from("departments").select("*").order("name", { ascending: true });
  const profileQuery = supabase.from("profiles").select("*").order("display_name", { ascending: true });
  const receiptQuery = supabase.from("receipts").select("*").order("receipt_date", { ascending: false });

  if (departmentIds?.length) {
    departmentQuery.in("id", departmentIds);
    profileQuery.in("department_id", departmentIds);
    receiptQuery.in("department_id", departmentIds);
  }

  const [departments, profiles, receipts] = await Promise.all([departmentQuery, profileQuery, receiptQuery]);
  const error = departments.error ?? profiles.error ?? receipts.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ departments: departments.data ?? [], profiles: profiles.data ?? [], receipts: receipts.data ?? [] });
}
