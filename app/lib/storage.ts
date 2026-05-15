import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeStatus } from "./calculations";
import { createSupabaseAdminClient } from "./supabase/admin";
import { RECEIPT_IMAGE_BUCKET } from "./domain";
import { Allocation, Database, Employee, EmployeeInput, Receipt, ReceiptAttachment, ReceiptInput } from "./types";

const ROOT = process.cwd();
const LOCAL_DB_PATH = path.join(process.env.VERCEL ? "/tmp/lunch_allowance" : path.join(ROOT, "data"), "local-db.json");
const LEGACY_LOCAL_DB_PATH = path.join("/tmp/lunch-subsidy-admin", "local-db.json");
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}${Date.now().toString(36)}`;

const seededEmployees = (): Employee[] => {
  const names = (process.env.SEED_EMPLOYEES || "Aaron")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const timestamp = now();
  return names.map((name) => ({
    employee_id: id("emp"),
    name,
    active: true,
    note: "",
    created_at: timestamp,
    updated_at: timestamp
  }));
};

const emptyDb = (): Database => ({ employees: seededEmployees(), receipts: [], allocations: [], attachments: [] });

export const hasSupabaseConfig = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const toEmployee = (profile: any): Employee => ({
  employee_id: profile.id,
  name: profile.display_name,
  active: profile.active,
  note: [profile.employee_no, profile.email].filter(Boolean).join(" / "),
  department_id: profile.department_id,
  department_name: profile.departments?.name ?? null,
  created_at: profile.created_at,
  updated_at: profile.updated_at
});

const toReceipt = (receipt: any): Receipt => ({
  receipt_id: receipt.id,
  date: receipt.receipt_date,
  payer_employee_id: receipt.payer_profile_id ?? receipt.submitted_by,
  submitted_by: receipt.submitted_by,
  department_id: receipt.department_id,
  applicant_name: receipt.metadata?.applicant_name,
  claimant_names: Array.isArray(receipt.metadata?.claimant_names) ? receipt.metadata.claimant_names : [],
  merchant: receipt.merchant ?? "",
  total_amount: Number(receipt.total_amount ?? 0),
  claimed_amount: Number(receipt.claimed_amount ?? 0),
  subsidy_amount: Number(receipt.subsidy_amount ?? 0),
  reimbursed_amount: Number(receipt.reimbursed_amount ?? 0),
  receipt_no: receipt.receipt_no ?? "",
  note: receipt.note ?? "",
  reimbursement_status: normalizeStatus(receipt.status),
  category: receipt.metadata?.category ?? null,
  created_at: receipt.created_at,
  updated_at: receipt.updated_at
});

const toAllocation = (claim: any): Allocation => ({
  allocation_id: claim.id,
  receipt_id: claim.receipt_id,
  date: claim.claim_date,
  employee_id: claim.profile_id,
  amount: Number(claim.claimed_amount ?? 0),
  note: claim.note ?? "",
  created_at: claim.created_at,
  updated_at: claim.updated_at
});

const toAttachment = (attachment: any): ReceiptAttachment => ({
  attachment_id: attachment.id,
  receipt_id: attachment.receipt_id,
  bucket: attachment.bucket ?? RECEIPT_IMAGE_BUCKET,
  object_path: attachment.object_path,
  file_name: attachment.object_path?.split("/").pop() ?? "receipt.jpg",
  content_type: attachment.content_type ?? "image/jpeg",
  size_bytes: Number(attachment.size_bytes ?? 0),
  created_at: attachment.created_at
});

async function readSupabase(): Promise<Database> {
  const supabase = createSupabaseAdminClient();
  const [profiles, receipts, claims, attachments] = await Promise.all([
    supabase.from("profiles").select("*, departments!profiles_department_id_fkey(name)").order("display_name", { ascending: true }),
    supabase.from("receipts").select("*").order("receipt_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("receipt_claims").select("*").order("claim_date", { ascending: false }).order("created_at", { ascending: true }),
    supabase.from("receipt_attachments").select("*").order("created_at", { ascending: true })
  ]);

  const error = profiles.error ?? receipts.error ?? claims.error ?? attachments.error;
  if (error) throw new Error(error.message);

  return {
    employees: (profiles.data ?? []).map(toEmployee),
    receipts: (receipts.data ?? []).map(toReceipt),
    allocations: (claims.data ?? []).map(toAllocation),
    attachments: (attachments.data ?? []).map(toAttachment)
  };
}

async function upsertEmployeeSupabase(input: EmployeeInput) {
  const supabase = createSupabaseAdminClient();
  if (!input.employee_id) {
    throw new Error("Supabase employee creation requires an Auth user. Use /api/admin/accounts with email and role.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: input.name, active: input.active ?? true, updated_at: now() })
    .eq("id", input.employee_id);
  if (error) throw new Error(error.message);
  return readSupabase();
}

async function upsertReceiptSupabase(input: ReceiptInput, receiptId?: string) {
  const supabase = createSupabaseAdminClient();
  const status = normalizeStatus(input.reimbursement_status);
  const { data, error } = await supabase.rpc("save_receipt_with_claims", {
    p_receipt_id: receiptId ?? null,
    p_receipt_date: input.date,
    p_payer_profile_id: input.payer_employee_id,
    p_merchant: input.merchant ?? "",
    p_receipt_no: input.receipt_no ?? "",
    p_total_amount: Math.round(Number(input.total_amount) * 100) / 100,
    p_note: input.note ?? "",
    p_category: input.category ?? "餐費補助",
    p_status: status === "paid" ? "settled" : status === "rejected" ? "rejected" : "submitted",
    p_allocations: input.allocations.map((allocation) => ({
      employee_id: allocation.employee_id,
      amount: Math.round(Number(allocation.amount) * 100) / 100,
      note: allocation.note ?? ""
    }))
  });
  if (error) throw new Error(error.message);
  const savedReceipt = data?.receipt;
  const savedClaims = Array.isArray(data?.claims) ? data.claims : [];
  if (!savedReceipt) throw new Error("Failed to save receipt");
  return {
    receipts: [toReceipt(savedReceipt)],
    allocations: savedClaims.map(toAllocation)
  };
}

async function deleteReceiptSupabase(receiptId: string) {
  const supabase = createSupabaseAdminClient();

  // 1. 先取得附件路徑，再從 Storage 刪除實際檔案
  const { data: attachments } = await supabase
    .from("receipt_attachments")
    .select("object_path, bucket")
    .eq("receipt_id", receiptId);

  if (attachments && attachments.length > 0) {
    const byBucket = new Map<string, string[]>();
    for (const a of attachments) {
      const bucket = a.bucket || process.env.RECEIPT_IMAGE_BUCKET || RECEIPT_IMAGE_BUCKET;
      const paths = byBucket.get(bucket) ?? [];
      paths.push(a.object_path);
      byBucket.set(bucket, paths);
    }
    await Promise.allSettled(
      [...byBucket.entries()].map(([bucket, paths]) =>
        supabase.storage.from(bucket).remove(paths)
      )
    );
  }

  // 2. 刪除資料庫記錄（receipt_attachments 與 receipt_claims 由 FK cascade 自動刪除）
  const { error } = await supabase.from("receipts").delete().eq("id", receiptId);
  if (error) throw new Error(error.message);
}

async function markReceiptsSupabase(receiptIds: string[], status: string) {
  const supabase = createSupabaseAdminClient();
  const normalized = normalizeStatus(status);
  const next = normalized === "paid" ? "settled" : normalized === "rejected" ? "rejected" : "submitted";
  const { data, error } = await supabase.rpc("mark_receipts_status", {
    p_receipt_ids: receiptIds,
    p_status: next
  });
  if (error) throw new Error(error.message);
  return {
    receipts: data?.receipts ?? [],
    claims: data?.claims ?? []
  };
}

async function readLocal(): Promise<Database> {
  try {
    const raw = await fs.readFile(LOCAL_DB_PATH, "utf8").catch(async (error: NodeJS.ErrnoException) => {
      if (process.env.VERCEL && error.code === "ENOENT") {
        return fs.readFile(LEGACY_LOCAL_DB_PATH, "utf8");
      }
      throw error;
    });
    const parsed = JSON.parse(raw) as Database;
    return {
      employees: parsed.employees ?? [],
      receipts: parsed.receipts ?? [],
      allocations: parsed.allocations ?? [],
      attachments: parsed.attachments ?? []
    };
  } catch {
    const db = emptyDb();
    await writeLocal(db);
    return db;
  }
}

async function writeLocal(db: Database) {
  await fs.mkdir(path.dirname(LOCAL_DB_PATH), { recursive: true });
  await fs.writeFile(LOCAL_DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

export async function readDb(): Promise<Database> {
  if (hasSupabaseConfig()) return readSupabase();
  return readLocal();
}

export async function writeDb(db: Database) {
  return writeLocal(db);
}

export async function upsertEmployee(input: EmployeeInput) {
  if (hasSupabaseConfig()) return upsertEmployeeSupabase(input);

  const db = await readDb();
  const timestamp = now();
  if (input.employee_id) {
    db.employees = db.employees.map((employee) =>
      employee.employee_id === input.employee_id
        ? { ...employee, name: input.name, active: input.active ?? employee.active, note: input.note ?? "", updated_at: timestamp }
        : employee
    );
  } else {
    db.employees.push({
      employee_id: id("emp"),
      name: input.name,
      active: input.active ?? true,
      note: input.note ?? "",
      created_at: timestamp,
      updated_at: timestamp
    });
  }
  await writeDb(db);
  return db;
}

export async function upsertReceipt(input: ReceiptInput, receiptId?: string) {
  if (hasSupabaseConfig()) return upsertReceiptSupabase(input, receiptId);

  const db = await readDb();
  const timestamp = now();
  const existing = receiptId ? db.receipts.find((receipt) => receipt.receipt_id === receiptId) : undefined;
  const nextId = existing?.receipt_id ?? id("rcpt");
  const receipt: Receipt = {
    receipt_id: nextId,
    date: input.date,
    payer_employee_id: input.payer_employee_id,
    merchant: input.merchant ?? "",
    total_amount: Number(input.total_amount),
    receipt_no: input.receipt_no ?? "",
    note: input.note ?? "",
    reimbursement_status: normalizeStatus(input.reimbursement_status ?? existing?.reimbursement_status),
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };
  const allocations: Allocation[] = input.allocations.map((allocation, index) => ({
    allocation_id: existing ? id("alloc") : id("alloc"),
    receipt_id: nextId,
    date: input.date,
    employee_id: allocation.employee_id,
    amount: Number(allocation.amount),
    note: allocation.note ?? "",
    created_at: existing?.created_at ?? new Date(Date.now() + index).toISOString(),
    updated_at: timestamp
  }));

  db.receipts = existing ? db.receipts.map((item) => (item.receipt_id === nextId ? receipt : item)) : [...db.receipts, receipt];
  db.allocations = [...db.allocations.filter((allocation) => allocation.receipt_id !== nextId), ...allocations];
  await writeDb(db);
  return db;
}

export async function deleteReceipt(receiptId: string) {
  if (hasSupabaseConfig()) return deleteReceiptSupabase(receiptId);

  const db = await readDb();
  db.receipts = db.receipts.filter((receipt) => receipt.receipt_id !== receiptId);
  db.allocations = db.allocations.filter((allocation) => allocation.receipt_id !== receiptId);
  await writeDb(db);
  return db;
}

export async function markReceipts(receiptIds: string[], status: string) {
  if (hasSupabaseConfig()) return markReceiptsSupabase(receiptIds, status);

  const db = await readDb();
  const next = normalizeStatus(status);
  const timestamp = now();
  db.receipts = db.receipts.map((receipt) =>
    receiptIds.includes(receipt.receipt_id) ? { ...receipt, reimbursement_status: next, updated_at: timestamp } : receipt
  );
  await writeDb(db);
  return db;
}
