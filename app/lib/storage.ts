import { google } from "googleapis";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { calculateDailyClaimSubsidies, normalizeStatus } from "./calculations";
import { createSupabaseAdminClient } from "./supabase/admin";
import { Allocation, Database, Employee, EmployeeInput, Receipt, ReceiptInput } from "./types";

const ROOT = process.cwd();
const LOCAL_DB_PATH = path.join(process.env.VERCEL ? "/tmp/lunch_allowance" : path.join(ROOT, "data"), "local-db.json");
const LEGACY_LOCAL_DB_PATH = path.join("/tmp/lunch-subsidy-admin", "local-db.json");
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}${Date.now().toString(36)}`;

const SHEETS = {
  Employees: ["employee_id", "name", "active", "note", "created_at", "updated_at"],
  Receipts: [
    "receipt_id",
    "date",
    "payer_employee_id",
    "merchant",
    "total_amount",
    "receipt_no",
    "note",
    "reimbursement_status",
    "created_at",
    "updated_at"
  ],
  Allocations: ["allocation_id", "receipt_id", "date", "employee_id", "amount", "note", "created_at", "updated_at"],
  Settlements: ["settlement_id", "period_start", "period_end", "payer_employee_id", "claimed_amount", "generated_at", "status"]
} as const;

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

const emptyDb = (): Database => ({ employees: seededEmployees(), receipts: [], allocations: [] });

const hasGoogleConfig = () =>
  Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);

export const hasSupabaseConfig = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const toEmployee = (profile: any): Employee => ({
  employee_id: profile.id,
  name: profile.display_name,
  active: profile.active,
  note: [profile.employee_no, profile.email].filter(Boolean).join(" / "),
  created_at: profile.created_at,
  updated_at: profile.updated_at
});

const toReceipt = (receipt: any): Receipt => ({
  receipt_id: receipt.id,
  date: receipt.receipt_date,
  payer_employee_id: receipt.payer_profile_id ?? receipt.submitted_by,
  merchant: receipt.merchant ?? "",
  total_amount: Number(receipt.total_amount ?? 0),
  receipt_no: receipt.receipt_no ?? "",
  note: receipt.note ?? "",
  reimbursement_status: receipt.status === "settled" ? "paid" : receipt.status === "approved" ? "claimed" : "pending",
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

async function readSupabase(): Promise<Database> {
  const supabase = createSupabaseAdminClient();
  const [profiles, receipts, claims] = await Promise.all([
    supabase.from("profiles").select("*").order("display_name", { ascending: true }),
    supabase.from("receipts").select("*").order("receipt_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("receipt_claims").select("*").order("claim_date", { ascending: false }).order("created_at", { ascending: true })
  ]);

  const error = profiles.error ?? receipts.error ?? claims.error;
  if (error) throw new Error(error.message);

  return {
    employees: (profiles.data ?? []).map(toEmployee),
    receipts: (receipts.data ?? []).map(toReceipt),
    allocations: (claims.data ?? []).map(toAllocation)
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
  const claimed = input.allocations.map((allocation, index) => ({
    id: receiptId ? undefined : undefined,
    profileId: allocation.employee_id,
    claimDate: input.date,
    claimedAmount: Number(allocation.amount),
    createdAt: new Date(Date.now() + index).toISOString()
  }));
  const subsidies = calculateDailyClaimSubsidies(claimed);
  const receiptPayload = {
    receipt_date: input.date,
    submitted_by: input.payer_employee_id,
    payer_profile_id: input.payer_employee_id,
    merchant: input.merchant ?? null,
    receipt_no: input.receipt_no ?? null,
    total_amount: Number(input.total_amount),
    status: normalizeStatus(input.reimbursement_status) === "paid" ? "settled" : normalizeStatus(input.reimbursement_status) === "claimed" ? "approved" : "submitted",
    note: input.note ?? null
  };

  const receiptResult = receiptId
    ? await supabase.from("receipts").update(receiptPayload).eq("id", receiptId).select("id").single()
    : await supabase.from("receipts").insert(receiptPayload).select("id").single();
  if (receiptResult.error || !receiptResult.data) throw new Error(receiptResult.error?.message ?? "Failed to save receipt");

  const nextReceiptId = receiptResult.data.id;
  const { error: deleteError } = await supabase.from("receipt_claims").delete().eq("receipt_id", nextReceiptId);
  if (deleteError) throw new Error(deleteError.message);

  const claims = input.allocations.map((allocation, index) => ({
    receipt_id: nextReceiptId,
    profile_id: allocation.employee_id,
    claim_date: input.date,
    claimed_amount: Number(allocation.amount),
    subsidy_amount: subsidies[index]?.subsidyAmount ?? 0,
    note: allocation.note ?? null,
    status: "claimed"
  }));
  const { error: claimError } = await supabase.from("receipt_claims").insert(claims);
  if (claimError) throw new Error(claimError.message);

  return readSupabase();
}

async function deleteReceiptSupabase(receiptId: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("receipts").delete().eq("id", receiptId);
  if (error) throw new Error(error.message);
  return readSupabase();
}

async function markReceiptsSupabase(receiptIds: string[], status: string) {
  const supabase = createSupabaseAdminClient();
  const next = normalizeStatus(status) === "paid" ? "settled" : normalizeStatus(status) === "claimed" ? "approved" : "submitted";
  const { error } = await supabase.from("receipts").update({ status: next }).in("id", receiptIds);
  if (error) throw new Error(error.message);
  return readSupabase();
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
      allocations: parsed.allocations ?? []
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

async function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

async function ensureSheetHeaders() {
  const sheets = await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(meta.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean));
  const requests = Object.keys(SHEETS)
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title } } }));

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  for (const [title, headers] of Object.entries(SHEETS)) {
    const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!1:1` });
    if (!result.data.values?.[0]?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...headers]] }
      });
    }
  }
}

const rowObjects = <T>(headers: readonly string[], rows: string[][] | undefined, mapper: (row: Record<string, string>) => T): T[] =>
  (rows ?? []).slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return mapper(row);
  });

async function readGoogle(): Promise<Database> {
  await ensureSheetHeaders();
  const sheets = await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  const result = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["Employees!A:F", "Receipts!A:J", "Allocations!A:H"]
  });
  const [employeesRows, receiptsRows, allocationsRows] = result.data.valueRanges?.map((range) => range.values as string[][] | undefined) ?? [];

  const db: Database = {
    employees: rowObjects(SHEETS.Employees, employeesRows, (row) => ({
      employee_id: row.employee_id,
      name: row.name,
      active: row.active !== "false",
      note: row.note,
      created_at: row.created_at,
      updated_at: row.updated_at
    })).filter((employee) => employee.employee_id),
    receipts: rowObjects(SHEETS.Receipts, receiptsRows, (row) => ({
      receipt_id: row.receipt_id,
      date: row.date,
      payer_employee_id: row.payer_employee_id,
      merchant: row.merchant,
      total_amount: Number(row.total_amount || 0),
      receipt_no: row.receipt_no,
      note: row.note,
      reimbursement_status: normalizeStatus(row.reimbursement_status),
      created_at: row.created_at,
      updated_at: row.updated_at
    })).filter((receipt) => receipt.receipt_id),
    allocations: rowObjects(SHEETS.Allocations, allocationsRows, (row) => ({
      allocation_id: row.allocation_id,
      receipt_id: row.receipt_id,
      date: row.date,
      employee_id: row.employee_id,
      amount: Number(row.amount || 0),
      note: row.note,
      created_at: row.created_at,
      updated_at: row.updated_at
    })).filter((allocation) => allocation.allocation_id)
  };

  if (!db.employees.length) {
    db.employees = seededEmployees();
    await writeGoogle(db);
  }

  return db;
}

async function writeGoogle(db: Database) {
  await ensureSheetHeaders();
  const sheets = await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: ["Employees!A:F", "Receipts!A:J", "Allocations!A:H"] }
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        {
          range: "Employees!A:F",
          values: [
            [...SHEETS.Employees],
            ...db.employees.map((e) => [e.employee_id, e.name, String(e.active), e.note, e.created_at, e.updated_at])
          ]
        },
        {
          range: "Receipts!A:J",
          values: [
            [...SHEETS.Receipts],
            ...db.receipts.map((r) => [
              r.receipt_id,
              r.date,
              r.payer_employee_id,
              r.merchant,
              r.total_amount,
              r.receipt_no,
              r.note,
              r.reimbursement_status,
              r.created_at,
              r.updated_at
            ])
          ]
        },
        {
          range: "Allocations!A:H",
          values: [
            [...SHEETS.Allocations],
            ...db.allocations.map((a) => [a.allocation_id, a.receipt_id, a.date, a.employee_id, a.amount, a.note, a.created_at, a.updated_at])
          ]
        }
      ]
    }
  });
}

export async function readDb(): Promise<Database> {
  if (hasSupabaseConfig()) return readSupabase();
  return hasGoogleConfig() ? readGoogle() : readLocal();
}

export async function writeDb(db: Database) {
  return hasGoogleConfig() ? writeGoogle(db) : writeLocal(db);
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
