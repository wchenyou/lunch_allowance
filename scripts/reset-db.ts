/**
 * 清空本地 Supabase 資料庫所有業務資料（保留 schema）
 * 用法：npx tsx --env-file=.env.local scripts/reset-db.ts
 *
 * ⚠️  這會永久刪除所有部門、帳號、收據等資料，無法復原！
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  缺少環境變數：NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 依照外鍵依賴順序，子表先刪
const TABLES_IN_ORDER = [
  "settlement_items",
  "settlements",
  "receipt_reviews",
  "receipt_attachments",
  "receipt_claims",
  "receipts",
  "department_admin_employees",
  "department_admin_departments",
  "profile_credentials",
  "profiles",
  "departments",
];

async function main() {
  console.log("\n⚠️   即將清空所有業務資料，此操作無法復原！");
  console.log("    按 Ctrl+C 取消，或等待 3 秒後繼續...\n");
  await new Promise((res) => setTimeout(res, 3000));

  for (const table of TABLES_IN_ORDER) {
    const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      // 如果表不存在也繼續
      console.warn(`  ⚠️  ${table}: ${error.message}`);
    } else {
      console.log(`  ✅  ${table} 已清空`);
    }
  }

  console.log("\n✅  資料庫已全部清空，可以重新建立資料了！\n");
}

main().catch((err) => {
  console.error("❌  錯誤:", err.message ?? err);
  process.exit(1);
});
