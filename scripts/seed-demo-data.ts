/**
 * Demo 資料生成腳本
 * 用法: npx tsx --env-file=.env.local scripts/seed-demo-data.ts
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ 缺少環境變數");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- 密碼 Hash 邏輯 ---
const KEY_LENGTH = 64;
function scrypt(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, {}, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$16384$8$1$${salt}$${derived.toString("base64url")}`;
}

// --- 資料定義 ---
const DEPARTMENTS = [
  { code: "ADM", name: "行政部" },
  { code: "HR", name: "人事部" },
  { code: "OPS", name: "營運部" },
  { code: "IT", name: "資訊部" },
];

const MERCHANTS = ["全家便利商店", "7-11", "吉野家", "八方雲集", "便當店", "麥當勞", "星巴克", "路易莎", "三商巧福", "肯德基"];
const CATEGORIES = ["餐費補助", "加班餐費", "部門聚餐"];

async function main() {
  console.log("🚀 開始生成 Demo 資料...");

  // 1. 建立部門
  const deptMap: Record<string, string> = {};
  for (const dept of DEPARTMENTS) {
    const { data, error } = await supabase.from("departments").upsert(dept, { onConflict: "code" }).select("id").single();
    if (error) throw error;
    deptMap[dept.name] = data.id;
    console.log(`✅ 已建立部門: ${dept.name}`);
  }

  const commonPasswordHash = await hashPassword("12345678");
  const adminPasswordHash = await hashPassword("admin");
  const now = new Date().toISOString();

  // 2. 建立最高管理員
  const { data: superAdmin, error: superError } = await supabase.from("profiles").upsert({
    employee_no: "admin",
    display_name: "系統管理員",
    role: "admin",
    app_role: "super_admin",
    active: true,
    password_hash: adminPasswordHash,
    onboarded_at: now,
  }).select("id").single();
  if (superError || !superAdmin) throw new Error(`建立最高管理員失敗: ${superError?.message}`);
  console.log("👑 已建立最高管理員: admin / admin");

  // 3. 建立部門行政與員工
  const admins: any[] = [];
  const employees: any[] = [];

  for (const [name, deptId] of Object.entries(deptMap)) {
    // 行政
    const adminNo = `admin_${name.slice(0, 2)}`;
    const { data: admin, error: adminError } = await supabase.from("profiles").upsert({
      employee_no: adminNo,
      display_name: `${name}行政`,
      department_id: deptId,
      role: "hr",
      app_role: "department_admin",
      active: true,
      password_hash: commonPasswordHash,
      onboarded_at: now,
    }).select("id, department_id").single();
    if (adminError || !admin) throw new Error(`建立行政帳號失敗: ${adminError?.message}`);
    admins.push(admin);
    
    // 建立管理範圍
    await supabase.from("department_admin_departments").upsert({
        admin_profile_id: admin.id,
        department_id: deptId
    });

    // 員工 1
    const emp1No = `emp_${name.slice(0, 2)}_1`;
    const { data: emp1, error: emp1Error } = await supabase.from("profiles").upsert({
      employee_no: emp1No,
      display_name: `${name}員工 A`,
      department_id: deptId,
      role: "employee",
      app_role: "employee",
      active: true,
      password_hash: commonPasswordHash,
      onboarded_at: now,
    }).select("id, department_id").single();
    if (emp1Error || !emp1) throw new Error(`建立員工1失敗: ${emp1Error?.message}`);
    employees.push(emp1);

    // 員工 2
    const emp2No = `emp_${name.slice(0, 2)}_2`;
    const { data: emp2, error: emp2Error } = await supabase.from("profiles").upsert({
      employee_no: emp2No,
      display_name: `${name}員工 B`,
      department_id: deptId,
      role: "employee",
      app_role: "employee",
      active: true,
      password_hash: commonPasswordHash,
      onboarded_at: now,
    }).select("id, department_id").single();
    if (emp2Error || !emp2) throw new Error(`建立員工2失敗: ${emp2Error?.message}`);
    employees.push(emp2);

    console.log(`👥 已建立 ${name} 的人員 (1 行政, 2 員工)`);
  }

  // 4. 建立收據單據 (25 筆)
  console.log("📝 正在生成收據資料...");
  for (let i = 0; i < 25; i++) {
    const creator = employees[Math.floor(Math.random() * employees.length)];
    const merchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 14)); // 過去 14 天內
    const dateStr = date.toISOString().split("T")[0];
    
    const isMulti = Math.random() > 0.7;
    const totalAmount = isMulti ? 300 + Math.floor(Math.random() * 200) : 100 + Math.floor(Math.random() * 100);
    
    // 建立收據
    const { data: receipt, error: rError } = await supabase.from("receipts").insert({
      receipt_date: dateStr,
      department_id: creator.department_id,
      submitted_by: creator.id,
      payer_profile_id: creator.id,
      merchant,
      currency: "TWD",
      total_amount: totalAmount,
      status: Math.random() > 0.3 ? "submitted" : "approved",
      metadata: { category },
    }).select("id").single();

    if (rError) {
        console.error("收據建立失敗", rError);
        continue;
    }

    // 建立請款明細
    if (isMulti) {
      // 兩個人分
      const amount1 = Math.floor(totalAmount / 2);
      const amount2 = totalAmount - amount1;
      const otherEmp = employees.find(e => e.id !== creator.id && e.department_id === creator.department_id) || creator;
      
      await supabase.from("receipt_claims").insert([
        { receipt_id: receipt.id, profile_id: creator.id, claim_date: dateStr, claimed_amount: amount1, status: "claimed" },
        { receipt_id: receipt.id, profile_id: otherEmp.id, claim_date: dateStr, claimed_amount: amount2, status: "claimed" }
      ]);
    } else {
      await supabase.from("receipt_claims").insert({
        receipt_id: receipt.id,
        profile_id: creator.id,
        claim_date: dateStr,
        claimed_amount: totalAmount,
        status: "claimed"
      });
    }
  }

  console.log("\n✨ Demo 資料生成完成！");
  console.log("----------------------------------");
  console.log("最高管理員: admin / admin");
  console.log("其他帳號密碼皆為: 12345678");
  console.log("範例帳號:");
  DEPARTMENTS.forEach(d => {
      const pfx = d.name.slice(0, 2);
      console.log(` - ${d.name}: admin_${pfx}, emp_${pfx}_1, emp_${pfx}_2`);
  });
}

main().catch(err => {
  console.error("❌ 執行失敗:", err);
  process.exit(1);
});
