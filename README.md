# Lunch Allowance

![version](https://img.shields.io/badge/version-1.1.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)

一套開源的企業餐費補助與收據報銷管理系統，使用 Next.js 15、TypeScript 與 Supabase 建置。員工可以用手機拍照上傳收據，行政人員可在後台審核、批次請款、匯出報表，適合用來管理每日餐費補助或類似的小額 reimbursement 流程。

## 功能特色

- 手機優先的員工上傳介面，支援拍照或從相簿選取收據
- 單張收據多人分攤，並依每人每日補助上限自動計算可請款金額
- Supabase Storage 收據照片上傳、壓縮與路徑管理
- 部門行政可審核、退單、批次請款
- 依員工、日期與狀態查詢歷史單據
- 匯出 CSV 報表與收據照片 ZIP
- 三層角色權限：最高管理員、部門行政、員工

## 角色與入口

| 角色 | 登入路徑 | 主要功能 |
|------|----------|----------|
| 最高管理員 | `/login/super-admin` | 管理部門、建立帳號、設定部門行政可管理的範圍 |
| 部門行政 | `/login/admin` | 審核單據、退單、批次請款、匯出報表與照片 |
| 員工 | `/login/employee` | 上傳收據、多人合單、查看個人請款紀錄與狀態 |

## 介面預覽

### 最高管理員

管理部門與人員帳號，包含新增部門、建立帳號及設定管理授權範圍。

![最高管理後台 - 部門與帳號管理](docs/screenshots/super_admin_dashboard.png)

### 部門行政

查看員工申請中的單據，可個別核准請款或退單，並查看附件照片。

![部門行政 - 單據列表](docs/screenshots/admin_receipt_list.png)

依員工彙總可請款金額，展開後可一次請款該員工的所有待處理單據。

![部門行政 - 員工請款列表](docs/screenshots/admin_payout_list.png)

![部門行政 - 請款管理彈窗](docs/screenshots/admin_payout_modal.png)

依日期、員工、類別等條件篩選歷史單據，支援匯出 CSV 報表或照片 ZIP。

![部門行政 - 單據統計](docs/screenshots/admin_stats.png)

### 員工手機端

員工可查看自己的單據紀錄、待請款筆數與可請款總金額。

![員工端 - 單據列表（手機版）](docs/screenshots/employee_receipt_list.png)

上傳表單支援手機拍照、相簿選取與多人合單。

![員工端 - 上傳單據彈窗（手機版）](docs/screenshots/employee_upload_modal.png)

## 技術棧

| 類別 | 技術 |
|------|------|
| Framework | Next.js 15 App Router |
| Language | TypeScript |
| Database | Supabase PostgreSQL + RLS |
| Storage | Supabase Storage |
| Styling | Vanilla CSS |
| Icons | Lucide React |
| Deployment | Vercel / Docker |

## 快速開始

### 需求

- Node.js 20+
- npm
- Supabase CLI

### 安裝

```bash
npm install
cp .env.example .env.local
```

編輯 `.env.local`：

```bash
ADMIN_PASSWORD=change-this-admin-password
APP_SESSION_SECRET=change-this-random-session-secret

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

RECEIPT_IMAGE_BUCKET=receipt-images
DAILY_SUBSIDY_LIMIT=150
```

### 初始化資料庫

本機開發可使用 Supabase CLI：

```bash
supabase start
supabase db reset
```

若使用雲端 Supabase 專案，請依序套用 `supabase/migrations/` 內的 SQL migration。

### 建立管理員或 Demo 資料

只建立最高管理員：

```bash
npx tsx --env-file=.env.local scripts/seed-super-admin.ts
```

建立 Demo 部門、帳號與單據：

```bash
npx tsx --env-file=.env.local scripts/seed-demo-data.ts
```

Demo 帳號僅供本地測試使用：

| 角色 | 帳號 | 密碼 |
|------|------|------|
| 最高管理員 | `admin` | `admin` |
| 部門行政 | `admin_行政` | `12345678` |
| 一般員工 | `emp_行政_1` | `12345678` |

正式環境請不要使用 Demo 密碼，部署後請立即更換所有初始密碼，並使用高強度的 `APP_SESSION_SECRET`。

### 啟動開發伺服器

```bash
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)。

## 常用指令

```bash
npm run dev        # 啟動開發伺服器
npm run build      # 建置正式版本
npm run start      # 啟動正式伺服器
npm run lint       # 執行 ESLint
npm run test:calc  # 驗證補助金額計算邏輯
```

## Docker

```bash
docker build -t lunch-allowance .

docker run -d \
  --name lunch-allowance-app \
  -p 8080:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e APP_SESSION_SECRET=your-session-secret \
  lunch-allowance
```

## 資料表

| 資料表 | 說明 |
|--------|------|
| `profiles` | 帳號、角色、員工編號與基本資料 |
| `departments` | 部門主檔 |
| `receipts` | 收據主檔 |
| `receipt_claims` | 收據分攤與請款明細 |
| `receipt_attachments` | 收據附件路徑 |
| `department_admin_departments` | 部門行政可管理的部門範圍 |
| `profile_credentials` | 自訂密碼登入憑證 |

## 開源與安全注意事項

- 不要提交 `.env.local`、`.vercel/`、`.next/`、`data/` 或任何真實收據照片。
- `SUPABASE_SERVICE_ROLE_KEY` 只能在伺服器端使用，請勿暴露到瀏覽器或公開文件。
- Demo 帳號和預設密碼只適合本地測試。
- 公開截圖前請確認沒有真實姓名、部門、收據、公司資訊或內部網址。
- 正式部署時請使用隨機且足夠長的 `APP_SESSION_SECRET`。
- 建議在公開 repository 前確認 Supabase RLS policy、Storage bucket policy 與 production migration 都符合預期。

## 授權

本專案採用 [MIT License](LICENSE) 開源授權。

## Changelog

### v1.1.0 (2026-05-13)

- 修復最高管理後台編輯帳號後儲存無反應問題
- 修復帳號更新時誤將 `onboarded_at` 重設的問題
- 修復員工後台多人合單驗證失敗後送出按鈕永久卡住的問題
- 優化員工上傳單據彈窗的手機版寬度
- 新增 `docs/screenshots/` UI 截圖目錄
- 強化 README 的角色說明、快速開始與開源安全注意事項
- 修正 `seed-demo-data.ts` TypeScript null 型別檢查

### v1.0.0 (2026-05-13)

- 首次正式開源發布
- 移除 Google Sheets 整合，以 Supabase 作為唯一資料來源
- 部門與帳號刪除改為硬刪除，有關聯資料時阻擋並提示
- 刪除操作前加入確認彈窗
- 修正後台側邊欄與登入 Session fallback 邏輯
