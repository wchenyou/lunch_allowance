import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
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
  const receiptQuery = supabase.from("receipts").select("*").order("receipt_date", { ascending: false }).order("created_at", { ascending: false });

  if (departmentIds?.length) {
    departmentQuery.in("id", departmentIds);
    profileQuery.in("department_id", departmentIds);
    receiptQuery.in("department_id", departmentIds);
  }

  const [departments, profiles, receipts] = await Promise.all([departmentQuery, profileQuery, receiptQuery]);
  const receiptIds = (receipts.data ?? []).map((receipt) => receipt.id);
  const [claims, attachments, permissions] = await Promise.all([
    receiptIds.length ? supabase.from("receipt_claims").select("*").in("receipt_id", receiptIds) : Promise.resolve({ data: [], error: null }),
    receiptIds.length ? supabase.from("receipt_attachments").select("*").in("receipt_id", receiptIds) : Promise.resolve({ data: [], error: null }),
    departmentIds?.length
      ? supabase.from("claimant_permissions").select("*").in("department_id", departmentIds)
      : supabase.from("claimant_permissions").select("*")
  ]);
  const error = departments.error ?? profiles.error ?? receipts.error ?? claims.error ?? attachments.error ?? permissions.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const bucket = process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
  const attachmentsWithUrls = await Promise.all(
    (attachments.data ?? []).map(async (attachment) => {
      const signed = await supabase.storage.from(bucket).createSignedUrl(attachment.object_path, 60 * 60);
      return {
        ...attachment,
        file_name: attachment.object_path.split("/").pop(),
        signed_url: signed.data?.signedUrl ?? null
      };
    })
  );
  return NextResponse.json({
    departments: departments.data ?? [],
    profiles: profiles.data ?? [],
    receipts: receipts.data ?? [],
    claims: claims.data ?? [],
    attachments: attachmentsWithUrls,
    claimantPermissions: permissions.data ?? []
  });
}
