# Lunch Allowance (午餐補助系統) &nbsp;![version](https://img.shields.io/badge/version-1.0.0-blue)

這是一個基於 Next.js 與 Supabase 構建的午餐補助管理系統。旨在簡化公司每日午餐費用的登記、分攤、審核與結算流程。

## 🌟 核心功能

- **三層角色權限控制**：
  - **員工端 (Mobile First)**：手機優先設計，方便員工隨時登記單據。
  - **部門行政端**：負責審核單據、查看統計與批次處理請款。
  - **系統管理端 (Super Admin)**：管理部門、帳號權限與全域設定。
- **多人收據分攤**：支援單張收據多人手動分攤，系統自動計算每人當日補助上限。
- **智能補助計算**：自動依據「每人每日上限 150 元」規則計算實際可請款金額，處理跨單據與超額邏輯。
- **收據影像上傳**：整合 Supabase Storage，支援單據照片上傳與預覽。
- **財務彙總與導出**：按付款人彙總應退款金額，支援 CSV 導出供財務入帳使用。
- **批次處理**：行政人員可批次核准或標記請款狀態，大幅提升管理效率。

## 🛠 技術棧

- **框架**: Next.js 15 (App Router)
- **語言**: TypeScript
- **資料庫**: Supabase (PostgreSQL)
- **存儲**: Supabase Storage (單據照片)
- **樣式**: Vanilla CSS (現代化、響應式設計)
- **圖標**: Lucide React

## 🚀 快速開始

### 1. 本地開發環境設定

```bash
# 安裝依賴
npm install

# 複製環境變數範本
cp .env.example .env.local

# 啟動開發伺服器
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000) 即可看到首頁。

### 2. 環境變數配置 (.env)

請確保配置以下必要的環境變數：

```bash
# 系統加密密鑰 (必填)
APP_SESSION_SECRET=your-random-session-secret
ADMIN_PASSWORD=your-super-admin-password

# Supabase 配置 (必填)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# 補助金額設定 (選填，預設 150)
DAILY_SUBSIDY_LIMIT=150
```

## 📊 資料庫 Schema

本專案使用 Supabase。核心資料表結構如下：

- `profiles`: 存放帳號資訊、員工編號與權限角色。
- `departments`: 部門主檔。
- `receipts`: 收據主檔，記錄日期、店家、總金額及審核狀態。
- `receipt_claims`: 每一筆收據的分攤明細與計算後的補助金額。
- `receipt_attachments`: 單據圖片的檔案路徑紀錄。

## 📦 部署

建議使用 **Vercel** 進行部署，並連結您的 Supabase 專案。

1. 在 Vercel 匯入 GitHub 倉庫。
2. 設定上述所有的環境變數。
3. 執行 `supabase/migrations` 下的 SQL 腳本來初始化您的資料庫結構與 RLS 政策。

## 📄 開源協議

本專案採用 [MIT License](LICENSE) 開源協議。

---

## 📝 Changelog

### v1.0.0 (2026-05-13)
首次正式開源發布。
- 移除 Google Sheets 整合，系統以 Supabase 為唯一資料來源
- 移除 `googleapis` 依賴
- 部門刪除改為方案 A：無關聯資料則直接從 DB 移除，有關聯資料則回傳明確錯誤
- 帳號刪除改為方案 A：無收據/請款紀錄則直接從 DB 移除，有資料則提示先處理
- 刪除操作前加入 `confirm()` 確認彈窗
- 修正 Admin 後台側邊欄動態顯示登入帳號名稱
- 修正登入 Session 帳號 fallback 邏輯
- 最高管理後台側邊欄顯示登入者姓名與帳號
- 員工請款管理彈窗加入請款筆數與收據金額統計，並過濾僅顯示「申請中」狀態
