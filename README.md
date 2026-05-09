# Lunch Allowance

午餐補助系統 MVP。公司每日每人午餐補助上限 150 元，少不補發；支援單張收據多人手動分攤、付款人追蹤、請款狀態與 CSV 匯出。

Supabase 升級第一階段已開始：`supabase/migrations/20260508093000_initial_lunch_subsidy.sql` 定義正式資料庫、Storage bucket、RLS policy；migration 檔名保留既有名稱以避免破壞已套用 schema。現有 Google Sheets / local JSON API 先保留，避免破壞 production 可用版本。

## 功能

- 管理密碼登入，密碼來自 `ADMIN_PASSWORD`
- 員工新增、編輯、停用
- 收據新增、編輯、刪除：日期、金額必填，店家、收據號碼、備註選填
- 付款人欄位：追蹤實際墊款者，以及未請款、已請款、已結清狀態
- 多人收據手動輸入每位員工分攤金額
- 今日每人補助狀態：登記金額、可請款、超額、未用額度
- 日期範圍結算，依付款人彙總公司應 reimbursement 金額
- CSV 匯出
- Google Sheets API 作為正式資料庫；無憑證時自動 fallback 到本地 `data/local-db.json`
- Supabase 目標架構：Auth + Postgres + private Storage bucket `receipt-images`
- 手機優先員工端骨架：`/employee`
- 管理端人員/帳號骨架：`/admin/people`

## 本地啟動

```bash
cd /Users/myopenclaw/.openclaw/workspace/lunch_allowance
npm install
cp .env.example .env
npm run dev
```

開啟 `http://localhost:3000`。如果沒有設定 `ADMIN_PASSWORD`，開發環境會暫用 `admin`，正式部署請務必設定強密碼。

## 登入入口

系統目前拆成三個登入入口，避免員工登入頁看到或連到最高管理權限入口：

- `/login/employee`：員工登入，僅接受 `employee` 帳號。
- `/login/admin`：一般管理登入，僅接受 `department_admin` 帳號。
- `/login/super-admin`：最高管理登入，僅接受 `super_admin` 帳號或 `ADMIN_PASSWORD` 系統管理密碼。

`/login` 會直接導向 `/login/employee`，不提供最高管理入口連結；登入 API 會依 `intended_role` 驗證角色，`/api/auth/options?role=employee|department_admin|super_admin` 只回傳該入口可用的登入選項。

## 環境變數

```bash
ADMIN_PASSWORD=change-this-admin-password
APP_SESSION_SECRET=change-this-random-session-secret
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
SUPABASE_PROJECT_REF=
RECEIPT_IMAGE_BUCKET=receipt-images
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
SEED_EMPLOYEES=Aaron
```

Supabase 變數中，`SUPABASE_SERVICE_ROLE_KEY` 只能放在 server-side / Vercel server environment，不可出現在 client bundle。管理端新增帳號若使用 Supabase Auth Admin API，必須由 server route 以 service role 執行。

Production 必須設定 `APP_SESSION_SECRET`、`ADMIN_PASSWORD` 或 `SUPABASE_JWT_SECRET` 其中之一作為 signed cookie secret；建議使用獨立的 `APP_SESSION_SECRET`。

只有 `GOOGLE_SHEETS_SPREADSHEET_ID`、`GOOGLE_SERVICE_ACCOUNT_EMAIL`、`GOOGLE_PRIVATE_KEY` 三個值都存在時，系統才會使用 Google Sheets。缺任一值時會使用本地 JSON fallback，因此 build 不會因 Google 憑證未就緒而失敗。

## Supabase Schema 規劃

正式資料表與關係：

- `departments`: 部門主檔，員工與收據可歸屬部門。
- `profiles`: 對應 `auth.users.id`，保存員工編號、姓名、部門、角色 `admin/hr/manager/employee`、啟用狀態。
- `receipts`: 單據主檔，含 `total_amount`、`claimed_amount`、`subsidy_amount`、`reimbursed_amount`、提交人、付款人、狀態。
- `receipt_claims`: 單據多人請款明細；每位參與者一列，含 `claimed_amount`、`subsidy_amount`、`reimbursed_amount`、狀態。
- `receipt_attachments`: 收據圖片 metadata；只存 bucket、object path、content type、大小等，不存圖片本體。
- `receipt_reviews`: 行政審核紀錄，保存 reviewer、action、前後狀態與留言。
- `settlements`: 期間結算主檔，可依部門或付款人彙總。
- `settlement_items`: 結算明細，連回每筆 `receipt_claims`。

Storage bucket:

- bucket 名稱：`receipt-images`
- private bucket，限制 image mime type，migration 內含 bucket 建立與 `storage.objects` RLS。
- 建議 object path：`{auth.uid()}/{receipt_id}/{file_id}.jpg`，便於 policy 限制上傳者只能寫入自己的資料夾。

目前 blocker：尚未提供 Supabase project ref、anon key、service role key，因此未實際部署或套用 migration。

## Google Sheet 設定

1. 在 Google Cloud 建立專案，啟用 Google Sheets API。
2. 建立 Service Account，產生 JSON key。
3. 建立一份 Google Sheet，將 Sheet 分享給 Service Account email，權限至少為 Editor。
4. 在 `.env` 或 Vercel Environment Variables 填入：
   - `GOOGLE_SHEETS_SPREADSHEET_ID`：Sheet URL 中 `/d/{id}/edit` 的 `{id}`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`：JSON key 裡的 `client_email`
   - `GOOGLE_PRIVATE_KEY`：JSON key 裡的 `private_key`，保留 `\n`

系統會自動建立或補齊下列 tabs 與第一列欄位：

- `Employees`: `employee_id, name, active, note, created_at, updated_at`
- `Receipts`: `receipt_id, date, payer_employee_id, merchant, total_amount, receipt_no, note, reimbursement_status, created_at, updated_at`
- `Allocations`: `allocation_id, receipt_id, date, employee_id, amount, note, created_at, updated_at`
- `Settlements`: `settlement_id, period_start, period_end, payer_employee_id, claimed_amount, generated_at, status`

## 補助計算規則

- 每位員工每日補助 = `min(當日分攤總額, 150)`
- 少於 150 不補發，只顯示未用額度
- 超過 150 的部分不補助
- 多張收據同日同員工超過 150 時，依 allocation 建立順序先到先補
- 付款人彙總不是收據總額加總，而是該付款人墊付收據中每筆 allocation 在員工當日 150 上限內可 reimbursement 的金額
- Supabase 版對應 helper：`calculateDailyClaimSubsidies()`，以 `profileId + claimDate` 分組，照 `claimDate/createdAt/id` 順序套用每日 150 上限。

## Vercel 部署

1. 將此專案推到 GitHub。
2. 在 Vercel 新增 Project，Root Directory 設為 `lunch_allowance`。
3. 設定 Environment Variables：至少 `ADMIN_PASSWORD`，正式使用 Google Sheets 時加上三個 Google 變數。
4. Build Command 使用預設 `npm run build`。
5. 不需要額外資料庫；Google Sheet 即為正式資料來源。

## 常用指令

```bash
npm run lint
npm run build
npm run dev
```
