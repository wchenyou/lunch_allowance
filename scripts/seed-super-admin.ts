/**
 * 一次性腳本：在 Supabase 建立或更新最高管理員帳號
 * 用法：npx tsx scripts/seed-super-admin.ts
 *
 * ⚠️  警告：本腳本使用預設的弱密碼，僅供開發/測試環境使用
 *           正式部署前請務必到後台修改密碼！
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";

// ──────────────────────────────────────────────────────────
// 設定：修改這裡的帳號/密碼
// ──────────────────────────────────────────────────────────
const ACCOUNT = "admin";   // employee_no 與 display_name
const PASSWORD = "admin";  // 初始密碼（請在部署後立即修改）
// ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_INTERNAL_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  缺少環境變數：NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  console.error("    請確認 .env.local 已正確設定，並用 dotenv 或 --env-file 載入");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 密碼 hash（與 app/lib/auth/password.ts 相同邏輯）──────
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

// ── 主程式 ────────────────────────────────────────────────
async function main() {
  console.log(`\n🔧  準備建立/更新最高管理員帳號: ${ACCOUNT}`);

  // 1. 查找現有帳號（以 employee_no 或 display_name 比對）
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, employee_no, display_name, app_role")
    .or(`employee_no.eq.${ACCOUNT},display_name.eq.${ACCOUNT}`)
    .maybeSingle();

  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date().toISOString();

  let profileId: string;

  if (existing) {
    console.log(`ℹ️   找到現有帳號 (id: ${existing.id})，將更新為 super_admin 並重設密碼`);
    const { error } = await supabase
      .from("profiles")
      .update({
        employee_no: ACCOUNT,
        display_name: ACCOUNT,
        role: "admin",
        app_role: "super_admin",
        active: true,
        login_disabled_at: null,
        password_hash: passwordHash,
        password_updated_at: now,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) throw error;
    profileId = existing.id;
  } else {
    console.log("ℹ️   未找到現有帳號，將新增...");
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        employee_no: ACCOUNT,
        display_name: ACCOUNT,
        role: "admin",
        app_role: "super_admin",
        active: true,
        password_hash: passwordHash,
        password_updated_at: now,
        onboarded_at: now,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (error) throw error;
    profileId = data.id;
  }

  // 2. 同步更新 profile_credentials（如果有此表）
  const { error: credError } = await supabase.from("profile_credentials").upsert({
    profile_id: profileId,
    password_hash: passwordHash,
    password_updated_at: now,
    must_change_password: false,
  }, { onConflict: "profile_id" });
  if (credError) {
    // 此表若不存在也不影響登入（系統會 fallback 到 profiles.password_hash）
    console.warn("⚠️   profile_credentials 更新失敗（此表可能不存在，可忽略）:", credError.message);
  }

  console.log(`\n✅  帳號已就緒！`);
  console.log(`   帳號: ${ACCOUNT}`);
  console.log(`   密碼: ${PASSWORD}`);
  console.log(`   角色: super_admin`);
  console.log(`   登入網址: /login/super-admin\n`);
  console.log("⚠️   請在登入後立即前往設定頁面修改密碼！\n");
}

main().catch((err) => {
  console.error("❌  錯誤:", err.message ?? err);
  process.exit(1);
});
