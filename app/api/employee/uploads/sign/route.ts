import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { hasSupabaseConfig } from "@/app/lib/storage";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const safeExtension = (contentType: string) => {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/heic") return "heic";
  if (contentType === "image/heif") return "heif";
  return "jpg";
};

export async function POST(request: Request) {
  const guard = await requireSession(["employee", "department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "Supabase storage is not configured" }, { status: 501 });
  }

  const input = await request.json();
  const profileId = String(input.profile_id ?? "").trim();
  const receiptId = String(input.receipt_id ?? "pending").trim();
  const contentType = String(input.content_type ?? "image/jpeg").trim();

  if (!profileId) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }
  if (guard.session!.role === "employee" && profileId !== guard.session!.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const objectPath = `${profileId}/${receiptId}/${randomUUID()}.${safeExtension(contentType)}`;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET).createSignedUploadUrl(objectPath);

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to create signed upload URL" }, { status: 500 });
  }

  return NextResponse.json({
    bucket: process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET,
    object_path: objectPath,
    token: data.token,
    signed_url: data.signedUrl
  });
}
