import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/api/guards";
import { RECEIPT_IMAGE_BUCKET } from "@/app/lib/domain";
import { createSupabaseAdminClient } from "@/app/lib/supabase/admin";

const DEFAULT_RECEIPT_LIMIT = 200;
const MAX_RECEIPT_LIMIT = 500;

export async function GET(request: Request) {
  const guard = await requireSession(["department_admin", "super_admin"]);
  if (guard.response) return guard.response;
  const session = guard.session!;
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const employee = url.searchParams.get("employee") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const category = url.searchParams.get("category") ?? "";
  const mode = url.searchParams.get("mode") ?? "dashboard";
  const limit = clampLimit(url.searchParams.get("limit"));
  const supabase = createSupabaseAdminClient();
  const departmentIds = session.role === "super_admin" ? undefined : session.departmentIds;
  if (departmentIds && departmentIds.length === 0) {
    return NextResponse.json({ departments: [], profiles: [], receipts: [], claims: [], attachments: [], claimantPermissions: [], limited: false });
  }

  const departmentQuery = supabase.from("departments").select("*").order("name", { ascending: true });
  const profileQuery = supabase.from("profiles").select("*").order("display_name", { ascending: true });
  let receiptQuery = supabase
    .from("receipts")
    .select("*")
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (departmentIds?.length) {
    departmentQuery.in("id", departmentIds);
    profileQuery.in("department_id", departmentIds);
    receiptQuery.in("department_id", departmentIds);
  }
  if (employee) {
    const { data: employeeClaims, error: employeeClaimsError } = await supabase
      .from("receipt_claims")
      .select("receipt_id")
      .eq("profile_id", employee)
      .limit(2000);
    if (employeeClaimsError) return NextResponse.json({ error: employeeClaimsError.message }, { status: 500 });
    const claimReceiptIds = [...new Set((employeeClaims ?? []).map((claim) => claim.receipt_id))];
    receiptQuery = claimReceiptIds.length
      ? receiptQuery.or(`submitted_by.eq.${employee},id.in.(${claimReceiptIds.join(",")})`)
      : receiptQuery.eq("submitted_by", employee);
  }
  if (start) receiptQuery = receiptQuery.gte("receipt_date", start);
  if (end) receiptQuery = receiptQuery.lte("receipt_date", end);
  if (status) receiptQuery = receiptQuery.eq("status", status);
  if (category) {
    receiptQuery = category === "餐費補助"
      ? receiptQuery.or("metadata->>category.eq.餐費補助,metadata->>category.is.null")
      : receiptQuery.eq("metadata->>category", category);
  }
  receiptQuery = receiptQuery.limit(mode === "stats" ? limit : DEFAULT_RECEIPT_LIMIT + 1);

  let claimantPermissionsQuery = supabase.from("claimant_permissions").select("*");
  if (departmentIds?.length) claimantPermissionsQuery = claimantPermissionsQuery.in("department_id", departmentIds);

  const [departments, profiles, receipts, claimantPermissions] = await Promise.all([departmentQuery, profileQuery, receiptQuery, claimantPermissionsQuery]);
  const allReceipts = receipts.data ?? [];
  const limited = mode !== "stats" && allReceipts.length > DEFAULT_RECEIPT_LIMIT;
  let scopedReceipts = limited ? allReceipts.slice(0, DEFAULT_RECEIPT_LIMIT) : allReceipts;
  const initialReceiptIds = scopedReceipts.map((receipt) => receipt.id);
  const [claims, attachments] = await Promise.all([
    initialReceiptIds.length ? supabase.from("receipt_claims").select("*").in("receipt_id", initialReceiptIds) : Promise.resolve({ data: [], error: null }),
    initialReceiptIds.length ? supabase.from("receipt_attachments").select("*").in("receipt_id", initialReceiptIds) : Promise.resolve({ data: [], error: null })
  ]);
  const error = departments.error ?? profiles.error ?? receipts.error ?? claimantPermissions.error ?? claims.error ?? attachments.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let scopedClaims = claims.data ?? [];
  if (employee) {
    const matchingReceiptIds = new Set(
      scopedReceipts
        .filter((receipt) => receipt.submitted_by === employee || scopedClaims.some((claim) => claim.receipt_id === receipt.id && claim.profile_id === employee))
        .map((receipt) => receipt.id)
    );
    scopedReceipts = scopedReceipts.filter((receipt) => matchingReceiptIds.has(receipt.id));
    scopedClaims = scopedClaims.filter((claim) => matchingReceiptIds.has(claim.receipt_id));
  }
  const receiptIds = new Set(scopedReceipts.map((receipt) => receipt.id));
  const bucket = process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
  let attachmentsWithUrls = (attachments.data ?? []).filter((attachment) => receiptIds.has(attachment.receipt_id)).map((attachment) => ({
    ...attachment,
    file_name: attachment.object_path.split("/").pop(),
    signed_url: undefined as string | undefined
  }));

  if (attachmentsWithUrls.length > 0) {
    const paths = attachmentsWithUrls.map((a) => a.object_path);
    const { data: signedUrlsData } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    if (signedUrlsData) {
      const urlMap = new Map(signedUrlsData.map((d) => [d.path, d.signedUrl]));
      attachmentsWithUrls = attachmentsWithUrls.map((attachment) => ({
        ...attachment,
        signed_url: urlMap.get(attachment.object_path) ?? undefined
      }));
    }
  }
  return NextResponse.json({
    departments: departments.data ?? [],
    profiles: profiles.data ?? [],
    receipts: scopedReceipts,
    claims: scopedClaims,
    attachments: attachmentsWithUrls,
    claimantPermissions: claimantPermissions.data ?? [],
    limited
  });
}

function clampLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECEIPT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_RECEIPT_LIMIT);
}
