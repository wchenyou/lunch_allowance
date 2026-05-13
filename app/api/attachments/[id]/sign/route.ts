import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return signAttachmentUrl(context);
}

export async function POST(_request: Request, context: RouteContext) {
  return signAttachmentUrl(context);
}

async function signAttachmentUrl({ params }: RouteContext) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;

  const { id } = await params;
  const attachmentId = String(id ?? "").trim();
  if (!attachmentId) {
    return NextResponse.json({ error: "Attachment id is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: attachment, error } = await supabase
    .from("receipt_attachments")
    .select("id, receipt_id, bucket, object_path, receipts(id, submitted_by, payer_profile_id, department_id)")
    .eq("id", attachmentId)
    .single();

  if (error || !attachment) {
    return NextResponse.json({ error: error?.message ?? "Attachment not found" }, { status: 404 });
  }

  const receipt = Array.isArray(attachment.receipts) ? attachment.receipts[0] : attachment.receipts;
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const session = guard.session!;
  let allowed = session.role === "super_admin";
  if (session.role === "department_admin") {
    allowed = Boolean(receipt.department_id && session.departmentIds.includes(receipt.department_id));
  }
  if (session.role === "employee") {
    allowed = receipt.submitted_by === session.profileId || receipt.payer_profile_id === session.profileId;
    if (!allowed) {
      const { data: claim } = await supabase
        .from("receipt_claims")
        .select("id")
        .eq("receipt_id", attachment.receipt_id)
        .eq("profile_id", session.profileId)
        .maybeSingle();
      allowed = Boolean(claim);
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bucket = attachment.bucket ?? process.env.RECEIPT_IMAGE_BUCKET ?? RECEIPT_IMAGE_BUCKET;
  const { data: signedData, error: signError } = await supabase.storage.from(bucket).createSignedUrl(attachment.object_path, 60 * 60);
  if (signError || !signedData?.signedUrl) {
    return NextResponse.json({ error: signError?.message ?? "Failed to create signed URL" }, { status: 500 });
  }

  return NextResponse.json({ signed_url: signedData.signedUrl });
}
