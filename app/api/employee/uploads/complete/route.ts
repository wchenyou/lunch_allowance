import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

export async function POST(request: Request) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const input = await request.json();
  const receiptId = String(input.receipt_id ?? "").trim();
  const objectPath = String(input.object_path ?? "").trim();
  const contentType = String(input.content_type ?? "image/jpeg").trim();
  const sizeBytes = Number(input.size_bytes ?? 0);

  if (!receiptId || !objectPath) {
    return NextResponse.json({ error: "receipt_id and object_path are required" }, { status: 400 });
  }
  if (!objectPath.startsWith(`${guard.session!.profileId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: receipt, error: receiptError } = await supabase
    .from("receipts")
    .select("id, submitted_by")
    .eq("id", receiptId)
    .single();
  if (receiptError || !receipt) {
    return NextResponse.json({ error: receiptError?.message ?? "Receipt not found" }, { status: 404 });
  }
  if (receipt.submitted_by !== guard.session!.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("receipt_attachments")
    .insert({
      receipt_id: receiptId,
      uploaded_by: guard.session!.profileId,
      bucket: process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET,
      object_path: objectPath,
      content_type: contentType,
      size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : null
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    attachment: {
      attachment_id: data.id,
      receipt_id: data.receipt_id,
      bucket: data.bucket ?? RECEIPT_IMAGE_BUCKET,
      object_path: data.object_path,
      file_name: data.object_path?.split("/").pop() ?? "receipt.jpg",
      content_type: data.content_type ?? "image/jpeg",
      size_bytes: Number(data.size_bytes ?? 0),
      created_at: data.created_at
    }
  });
}
