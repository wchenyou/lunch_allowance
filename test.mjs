import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. Load .env.local before running this script.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: dept, error: deptErr } = await supabase.from("departments").upsert({ code: "TEST001", name: "TEST_DEPT", active: true }, { onConflict: "code" }).select().single();
  if (deptErr) throw deptErr;
  const deptId = dept.id;
  
  const { data: emp, error: empErr } = await supabase.from("profiles").upsert({
    employee_no: "EMP001",
    display_name: "Test Employee",
    department_id: deptId,
    role: "employee",
    app_role: "employee",
    active: true,
    password_hash: "dummy"
  }, { onConflict: "employee_no" }).select().single();
  if (empErr) throw empErr;

  const { error: adminErr } = await supabase.from("profiles").upsert({
    employee_no: "ADM001",
    display_name: "Test Admin",
    department_id: deptId,
    role: "admin",
    app_role: "department_admin",
    active: true,
    password_hash: "dummy"
  }, { onConflict: "employee_no" }).select().single();
  if (adminErr) throw adminErr;

  const { data: receipt, error: recErr } = await supabase.from("receipts").insert({
    submitted_by: emp.id,
    department_id: deptId,
    receipt_date: "2026-05-12",
    total_amount: 100,
    status: "submitted"
  }).select().single();
  if (recErr) throw recErr;
  
  await supabase.from("receipt_claims").insert({
    receipt_id: receipt.id,
    profile_id: emp.id,
    subsidy_amount: 100
  });

  const { data: testFetch } = await supabase.from("receipts").select("id, receipt_date, department_id, receipts_department:departments(name), receipt_claims(profile_id, profiles(display_name))");
  console.log("DB Test Success, receipts found:", testFetch.length);
  process.exit(0);
}
run().catch(console.error);
