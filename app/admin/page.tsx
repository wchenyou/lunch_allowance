"use client";

import { ClipboardList, Download, FileArchive, KeyRound, LogOut, ReceiptText, WalletCards, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Department, Profile } from "@/app/lib/domain";

const money = (value: number) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);

type Tab = "receipts" | "payouts" | "stats";
type Claim = { id: string; receipt_id: string; profile_id: string; claimed_amount: number; subsidy_amount: number; reimbursed_amount: number; status: string };
type Attachment = { id: string; receipt_id: string; object_path: string; file_name?: string; signed_url?: string | null };
type ReceiptRow = {
  id: string;
  receipt_date: string;
  department_id: string | null;
  submitted_by: string;
  merchant: string | null;
  receipt_no: string | null;
  total_amount: number;
  claimed_amount: number;
  subsidy_amount: number;
  reimbursed_amount: number;
  status: string;
  note: string | null;
  created_at: string;
  metadata?: { applicant_name?: string; claimant_names?: string[]; category?: string };
};
type AdminSummary = { pendingApplicantCount: number; pendingReceiptCount: number; totalClaimedAmount: number; totalSubsidyAmount: number };
type AdminScope = {
  departments: Department[];
  profiles: Profile[];
  receipts: ReceiptRow[];
  claims: Claim[];
  attachments: Attachment[];
  summary?: AdminSummary;
  limited?: boolean;
};

const statusLabels: Record<string, string> = { submitted: "申請中", settled: "已放款", rejected: "退單" };

export default function DepartmentAdminPage() {
  const router = useRouter();
  const [scope, setScope] = useState<AdminScope>({ departments: [], profiles: [], receipts: [], claims: [], attachments: [] });
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, string>>({});
  const [session, setSession] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("receipts");
  const [hasSearched, setHasSearched] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<Tab>>(() => new Set(["receipts"]));
  const [message, setMessage] = useState("");
  const [activeEmployeeId, setActiveEmployeeId] = useState("");
  const [filters, setFilters] = useState({ start: "", end: "", employee: "", status: "", category: "" });
  const [committedFilters, setCommittedFilters] = useState({ start: "", end: "", employee: "", status: "", category: "" });
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current_password: "", next_password: "" });

  const refresh = useCallback(async (nextTab: Tab = tab) => {
    const query = new URLSearchParams({ view: nextTab }).toString();
    const [scopeRes, sessionRes] = await Promise.all([
      fetch(`/api/admin/scope?${query}`, { cache: "no-store" }),
      fetch("/api/auth/session")
    ]);
    const scopeBody = await scopeRes.json();
    const sessionBody = await sessionRes.json();
    
    if (!scopeRes.ok) {
      setMessage(scopeBody.error || "無法載入部門行政資料");
      return;
    }
    mergeScope(scopeBody, nextTab);
    setLoadedTabs((current) => new Set([...current, nextTab]));
    setMessage(scopeBody.limited ? "目前顯示最近 200 筆單據；請到單據統計用條件查詢完整資料。" : "");
    if (sessionRes.ok) {
      setSession(sessionBody.session);
    }
  }, [tab]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab !== "stats") {
      setHasSearched(false);
      setCommittedFilters({ start: "", end: "", employee: "", status: "", category: "" });
    }
    if (!loadedTabs.has(tab)) {
      refresh(tab);
    }
  }, [loadedTabs, refresh, tab]);

  async function searchStats() {
    const query = new URLSearchParams({ ...filters, mode: "stats", view: "stats", limit: "500" }).toString();
    const response = await fetch(`/api/admin/scope?${query}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "查詢失敗");
      return;
    }
    mergeScope(body, "stats");
    setLoadedTabs((current) => new Set([...current, "stats"]));
    setCommittedFilters(filters);
    setHasSearched(true);
    setMessage(body.receipts?.length >= 500 ? "查詢結果先顯示前 500 筆；請縮小條件取得更精準結果。" : "");
  }

  async function refreshSummary() {
    const response = await fetch("/api/admin/scope?view=summary", { cache: "no-store" });
    const body = await response.json();
    if (response.ok && body.summary) {
      setScope((current) => ({ ...current, summary: body.summary }));
    }
  }

  const profilesById = useMemo(() => new Map(scope.profiles.map((profile) => [profile.id, profile])), [scope.profiles]);
  const departmentsById = useMemo(() => new Map(scope.departments.map((department) => [department.id, department])), [scope.departments]);
  const claimsByReceipt = useMemo(() => groupBy(scope.claims, (claim) => claim.receipt_id), [scope.claims]);
  const attachmentsByReceipt = useMemo(() => groupBy(scope.attachments, (attachment) => attachment.receipt_id), [scope.attachments]);
  const employees = useMemo(() => scope.profiles.filter((profile) => (profile.app_role ?? profile.role) === "employee"), [scope.profiles]);
  const filteredReceipts = useMemo(
    () =>
      scope.receipts
        .filter((receipt) => !committedFilters.start || receipt.receipt_date >= committedFilters.start)
        .filter((receipt) => !committedFilters.end || receipt.receipt_date <= committedFilters.end)
        .filter((receipt) => !committedFilters.status || receipt.status === committedFilters.status)
        .filter((receipt) => !committedFilters.category || (receipt.metadata?.category ?? "餐費補助") === committedFilters.category)
        .filter((receipt) => !committedFilters.employee || receipt.submitted_by === committedFilters.employee || (claimsByReceipt.get(receipt.id) ?? []).some((claim) => claim.profile_id === committedFilters.employee)),
    [claimsByReceipt, committedFilters, scope.receipts]
  );
  const employeeSummaries = useMemo(
    () =>
      employees.map((employee) => {
        // Only count amounts for receipts where this employee is the actual submitter (applicant)
        const submittedReceipts = scope.receipts.filter(r => r.submitted_by === employee.id && r.status === "submitted");
        const actualTotal = submittedReceipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
        
        // Capped amount is the sum of subsidy_amount for all claims attached to those specific receipts
        const receiptIds = new Set(submittedReceipts.map(r => r.id));
        const subsidyTotal = scope.claims
          .filter(c => receiptIds.has(c.receipt_id))
          .reduce((sum, c) => sum + Number(c.subsidy_amount || 0), 0);

        return { employee, actualTotal, subsidyTotal, receiptIds: [...receiptIds] };
      }),
    [employees, scope.claims, scope.receipts]
  );
  const activeEmployee = employees.find((employee) => employee.id === activeEmployeeId);
  const activeEmployeeReceipts = activeEmployee
    ? scope.receipts.filter((receipt) => receipt.status === "submitted" && (claimsByReceipt.get(receipt.id) ?? []).some((claim) => claim.profile_id === activeEmployee.id))
    : [];

  function mergeScope(nextScope: AdminScope, targetTab: Tab) {
    setScope((current) => ({
      departments: nextScope.departments?.length ? nextScope.departments : current.departments,
      profiles: nextScope.profiles?.length ? nextScope.profiles : current.profiles,
      receipts: nextScope.receipts ?? current.receipts,
      claims: nextScope.claims ?? current.claims,
      attachments: targetTab === "payouts" ? current.attachments : nextScope.attachments ?? current.attachments,
      summary: nextScope.summary ?? current.summary,
      limited: nextScope.limited
    }));
  }

  async function openAttachment(attachment: Attachment) {
    const cachedUrl = signedUrlCache[attachment.id] ?? attachment.signed_url;
    if (cachedUrl) {
      window.open(cachedUrl, "_blank");
      return;
    }
    const response = await fetch(`/api/attachments/${attachment.id}/sign`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.signed_url) {
      setMessage(body.error || "照片連結產生失敗");
      return;
    }
    setSignedUrlCache((current) => ({ ...current, [attachment.id]: body.signed_url }));
    window.open(body.signed_url, "_blank");
  }

  async function markReceipts(receiptIds: string[], status: string) {
    const response = await fetch("/api/reimbursements/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptIds, status })
    });
    const body = await response.json();
    setMessage(response.ok ? "單據狀態已更新" : body.error || "狀態更新失敗");
    if (response.ok) {
      setActiveEmployeeId("");
      applyReceiptMutation(body.receipts ?? [], body.claims ?? []);
      await refreshSummary();
    }
  }

  function applyReceiptMutation(updatedReceipts: ReceiptRow[], updatedClaims: Claim[]) {
    if (!updatedReceipts.length && !updatedClaims.length) return;
    const updatedReceiptIds = new Set(updatedReceipts.map((receipt) => receipt.id));
    const updatedClaimReceiptIds = new Set(updatedClaims.map((claim) => claim.receipt_id));
    setScope((current) => ({
      ...current,
      receipts: current.receipts.map((receipt) => updatedReceipts.find((updated) => updated.id === receipt.id) ?? receipt),
      claims: [
        ...current.claims.filter((claim) => !updatedClaimReceiptIds.has(claim.receipt_id) && !updatedReceiptIds.has(claim.receipt_id)),
        ...updatedClaims
      ]
    }));
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/employee/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(passwordForm)
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "密碼更新失敗");
      return;
    }
    setPasswordForm({ current_password: "", next_password: "" });
    setPasswordModalOpen(false);
    setMessage("密碼已更新");
  }

  const exportQuery = new URLSearchParams(filters).toString();

  return (
    <div className="app-shell admin-skeleton">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">行</div>
          <div>
            <strong>{session?.role === "super_admin" ? "最高管理權限" : "部門行政管理"}</strong>
            <span>{session ? (session.displayName + (session.account && session.account !== session.displayName ? ` (${session.account})` : "")) : "載入中..."}</span>
          </div>
        </div>
        <nav>
          <NavButton active={tab === "receipts"} icon={<ClipboardList size={16} />} label="單據列表" onClick={() => setTab("receipts")} />
          <NavButton active={tab === "payouts"} icon={<WalletCards size={16} />} label="員工請款" onClick={() => setTab("payouts")} />
          <NavButton active={tab === "stats"} icon={<ReceiptText size={16} />} label="單據統計" onClick={() => setTab("stats")} />
        </nav>
        <div style={{ marginTop: "auto" }}>
          <NavButton active={false} icon={<KeyRound size={16} />} label="更改密碼" onClick={() => setPasswordModalOpen(true)} />
          <NavButton active={false} icon={<LogOut size={16} />} label="登出" onClick={handleLogout} />
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Department admin scope</p>
            <h1>{tabTitle(tab)}</h1>
          </div>
          {message ? <div className="toast">{message}</div> : null}
        </header>

        {tab !== "stats" ? (
          <section className="metric-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <Metric label="申請中人數" value={String(scope.summary?.pendingApplicantCount ?? 0)} />
            <Metric label="申請中單據" value={String(scope.summary?.pendingReceiptCount ?? 0)} />
            <Metric label="總收據請款金額" value={money(scope.summary?.totalClaimedAmount ?? 0)} />
            <Metric label="總可請款金額" value={money(scope.summary?.totalSubsidyAmount ?? 0)} />
          </section>
        ) : null}

        {tab === "receipts" ? (
          <section className="panel">
            <ReceiptTable
              receipts={scope.receipts}
              claimsByReceipt={claimsByReceipt}
              attachmentsByReceipt={attachmentsByReceipt}
              profilesById={profilesById}
              departmentsById={departmentsById}
              onOpenAttachment={openAttachment}
              onPaid={(id) => markReceipts([id], "settled")}
              onRejected={(id) => markReceipts([id], "rejected")}
            />
          </section>
        ) : null}

        {tab === "payouts" ? (
          <section className="panel">
            <DataTable
              headers={["員工", "申請中金額", "可請款金額", ""]}
              rows={employeeSummaries.map((summary) => [
                summary.employee.display_name,
                money(summary.actualTotal),
                money(summary.subsidyTotal),
                <button className="ghost-btn compact" key={summary.employee.id} onClick={() => setActiveEmployeeId(summary.employee.id)}>請款管理</button>
              ])}
              empty="尚無員工資料"
            />
          </section>
        ) : null}

        {tab === "stats" ? (
          <section className="stack">
            <div className="panel">
              <div className="filters stats-filter-row">
                <div className="filter-group">
                  <label>起日<input type="date" className="date-input" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} /></label>
                  <label>迄日<input type="date" className="date-input" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} /></label>
                  <label>員工<select value={filters.employee} onChange={(event) => setFilters({ ...filters, employee: event.target.value })}><option value="">全部</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}</select></label>
                  <label>狀態<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">全部</option><option value="submitted">申請中</option><option value="settled">已放款</option><option value="rejected">退單</option></select></label>
                  <label>項目<select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="">全部</option><option value="餐費補助">餐費補助</option><option value="物品請購">物品請購</option></select></label>
                  <button className="primary-btn" style={{ marginTop: "auto" }} onClick={searchStats}>查詢</button>
                </div>
                <div className="export-actions">
                  <a className="primary-btn link-btn" href={`/api/reimbursements/export?${exportQuery}`}><Download size={16} /> 匯出 CSV</a>
                  <a className="ghost-btn link-btn" href={`/api/admin/exports/photos?${exportQuery}`}><FileArchive size={16} /> 匯出照片 ZIP</a>
                </div>
              </div>
            </div>
            {hasSearched ? (
              <div className="panel">
                <ReceiptTable
                  receipts={filteredReceipts}
                  claimsByReceipt={claimsByReceipt}
                  attachmentsByReceipt={attachmentsByReceipt}
                  profilesById={profilesById}
                  departmentsById={departmentsById}
                  onOpenAttachment={openAttachment}
                  isStats={true}
                />
              </div>
            ) : null}
          </section>
        ) : null}

      </main>
      {activeEmployee ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setActiveEmployeeId("")}>
          <div className="modal-card wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="panel-title inline-title">
                <WalletCards size={17} />
                <h2>{activeEmployee.display_name} 請款管理</h2>
                <div className="modal-summary-badges">
                  <span className="badge">請款筆數: {activeEmployeeReceipts.filter(r => r.status === "submitted").length} 筆</span>
                  <span className="badge">總收據金額: {money(activeEmployeeReceipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0))}</span>
                  <span className="badge primary badge-lg">可請款總額: {money(activeEmployeeReceipts.reduce((sum, r) => {
                    const claims = claimsByReceipt.get(r.id) ?? [];
                    return sum + claims.reduce((cSum, c) => cSum + Number(c.subsidy_amount || 0), 0);
                  }, 0))}</span>
                </div>
              </div>
              <div className="modal-actions">
                {activeEmployeeReceipts.some(r => r.status === "submitted") ? (
                  <button 
                    className="primary-btn compact" 
                    onClick={() => {
                      if (window.confirm(`確定要將 ${activeEmployee.display_name} 的所有申請中單據標記為已放款嗎？`)) {
                        markReceipts(activeEmployeeReceipts.filter(r => r.status === "submitted").map(r => r.id), "settled");
                      }
                    }}
                  >
                    全部請款
                  </button>
                ) : null}
                <button className="icon-btn" title="關閉" onClick={() => setActiveEmployeeId("")}><X size={15} /></button>
              </div>
            </div>
            <ReceiptTable
              receipts={activeEmployeeReceipts}
              claimsByReceipt={claimsByReceipt}
              attachmentsByReceipt={attachmentsByReceipt}
              profilesById={profilesById}
              departmentsById={departmentsById}
              onOpenAttachment={openAttachment}
              onPaid={(id) => markReceipts([id], "settled")}
              onRejected={(id) => markReceipts([id], "rejected")}
            />
          </div>
        </div>
      ) : null}
      {passwordModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPasswordModalOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="panel-title inline-title">
                <KeyRound size={17} />
                <h2>更改登入密碼</h2>
              </div>
              <button className="icon-btn" title="關閉" onClick={() => setPasswordModalOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <form className="form-grid single" onSubmit={changePassword}>
              <label>
                目前密碼
                <input type="password" value={passwordForm.current_password} onChange={(event) => setPasswordForm({ ...passwordForm, current_password: event.target.value })} />
              </label>
              <label>
                新密碼
                <input type="password" minLength={8} value={passwordForm.next_password} onChange={(event) => setPasswordForm({ ...passwordForm, next_password: event.target.value })} required />
              </label>
              <div className="form-actions">
                <button type="button" className="ghost-btn" onClick={() => setPasswordModalOpen(false)}>
                  取消
                </button>
                <button className="primary-btn" type="submit">
                  更新密碼
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReceiptTable({ receipts, claimsByReceipt, attachmentsByReceipt, profilesById, departmentsById, onOpenAttachment, onPaid, onRejected, isStats }: {
  receipts: ReceiptRow[];
  claimsByReceipt: Map<string, Claim[]>;
  attachmentsByReceipt: Map<string, Attachment[]>;
  profilesById: Map<string, Profile>;
  departmentsById: Map<string, Department>;
  onOpenAttachment: (attachment: Attachment) => void;
  onPaid?: (id: string) => void;
  onRejected?: (id: string) => void;
  isStats?: boolean;
}) {
  const sortedReceipts = [...receipts].sort((a, b) => {
    if (isStats) {
      return `${a.receipt_date}|${a.created_at}`.localeCompare(`${b.receipt_date}|${b.created_at}`);
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const headers = isStats 
    ? ["編號", "申請日期", "單據日期", "項目", "店家名稱", "部門", "請款人", "請款人數", "單據總金額", "可請款金額", "照片名稱", "備註"]
    : ["編號", "申請日期", "單據日期", "項目", "店家名稱", "部門", "申請人", "請款人", "請款人數", "單據總金額", "可請款金額", "狀態", "照片", "", "備註"];

  return (
    <DataTable
      headers={headers}
      rows={sortedReceipts.map((receipt, index) => {
        const claims = claimsByReceipt.get(receipt.id) ?? [];
        const attachments = attachmentsByReceipt.get(receipt.id) ?? [];
        
        if (isStats) {
          return [
            index + 1,
            receipt.created_at.slice(0, 10),
            receipt.receipt_date,
            receipt.metadata?.category ?? "餐費補助",
            receipt.merchant ?? "-",
            departmentsById.get(receipt.department_id ?? "")?.name ?? "-",
            claims.map((claim) => profilesById.get(claim.profile_id)?.display_name ?? "-").join("、"),
            claims.length.toString(),
            money(Number(receipt.total_amount ?? 0)),
            money(claims.reduce((sum, claim) => sum + Number(claim.subsidy_amount || 0), 0)),
            attachments.length ? attachments.map((attachment) => <button className="link-button" key={attachment.id} onClick={() => onOpenAttachment(attachment)}>{attachment.file_name ?? attachment.object_path.split("/").pop()}</button>) : "-",
            receipt.note?.trim() || "-"
          ];
        }

        return [
          index + 1,
          receipt.created_at.slice(0, 10),
          receipt.receipt_date,
          receipt.metadata?.category ?? "餐費補助",
          receipt.merchant ?? "-",
          departmentsById.get(receipt.department_id ?? "")?.name ?? "-",
          receipt.metadata?.applicant_name ?? profilesById.get(receipt.submitted_by)?.display_name ?? "-",
          claims.map((claim) => profilesById.get(claim.profile_id)?.display_name ?? "-").join("、"),
          claims.length.toString(),
          money(Number(receipt.total_amount ?? 0)),
          money(claims.reduce((sum, claim) => sum + Number(claim.subsidy_amount || 0), 0)),
          <span className={`status ${receipt.status === "settled" ? "paid" : receipt.status === "rejected" ? "rejected" : "claimed"}`} key="status">{statusLabels[receipt.status] ?? "申請中"}</span>,
          attachments.length ? attachments.map((attachment) => <button className="link-button" key={attachment.id} onClick={() => onOpenAttachment(attachment)}>{attachment.file_name ?? attachment.object_path.split("/").pop()}</button>) : "-",
          <div className="row-actions" key="actions">
            {onPaid && receipt.status === "submitted" ? <button className="ghost-btn compact" onClick={() => onPaid(receipt.id)}>請款</button> : null}
            {onRejected && receipt.status === "submitted" ? <button className="ghost-btn compact" onClick={() => onRejected(receipt.id)}>退單</button> : null}
          </div>,
          receipt.note?.trim() || "-"
        ];
      })}
      empty="沒有符合條件的單據"
    />
  );
}

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? "nav-btn active" : "nav-btn"} onClick={onClick}>{icon}{label}</button>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function DataTable({ headers, rows, empty }: { headers: string[]; rows: Array<Array<ReactNode>>; empty: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className={["請款人", "申請人", "備註"].includes(headers[cellIndex]) ? "wrap-cell" : undefined} key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function tabTitle(tab: Tab) {
  return {
    receipts: "單據列表",
    payouts: "員工請款列表",
    stats: "單據統計"
  }[tab];
}
