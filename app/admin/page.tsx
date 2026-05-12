"use client";

import { Building2, ClipboardList, Download, FileArchive, KeyRound, LogOut, ReceiptText, Trash2, UsersRound, WalletCards, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Department, Profile } from "@/app/lib/domain";

const money = (value: number) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);

type Tab = "receipts" | "payouts" | "stats" | "permissions";
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
  metadata?: { applicant_name?: string; claimant_names?: string[] };
};
type Permission = { department_id: string; employee_profile_id: string; claimant_profile_id: string };
type AdminScope = {
  departments: Department[];
  profiles: Profile[];
  receipts: ReceiptRow[];
  claims: Claim[];
  attachments: Attachment[];
  claimantPermissions: Permission[];
};

const statusLabels: Record<string, string> = { submitted: "申請中", settled: "已放款", rejected: "退單" };

export default function DepartmentAdminPage() {
  const router = useRouter();
  const [scope, setScope] = useState<AdminScope>({ departments: [], profiles: [], receipts: [], claims: [], attachments: [], claimantPermissions: [] });
  const [tab, setTab] = useState<Tab>("receipts");
  const [message, setMessage] = useState("");
  const [activeEmployeeId, setActiveEmployeeId] = useState("");
  const [filters, setFilters] = useState({ start: "", end: "", employee: "", status: "" });
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current_password: "", next_password: "" });

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const response = await fetch("/api/admin/scope", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "無法載入部門行政資料");
      return;
    }
    setScope(body);
  }

  const profilesById = useMemo(() => new Map(scope.profiles.map((profile) => [profile.id, profile])), [scope.profiles]);
  const departmentsById = useMemo(() => new Map(scope.departments.map((department) => [department.id, department])), [scope.departments]);
  const claimsByReceipt = useMemo(() => groupBy(scope.claims, (claim) => claim.receipt_id), [scope.claims]);
  const attachmentsByReceipt = useMemo(() => groupBy(scope.attachments, (attachment) => attachment.receipt_id), [scope.attachments]);
  const employees = useMemo(() => scope.profiles.filter((profile) => (profile.app_role ?? profile.role) === "employee"), [scope.profiles]);
  const filteredReceipts = useMemo(
    () =>
      scope.receipts
        .filter((receipt) => !filters.start || receipt.receipt_date >= filters.start)
        .filter((receipt) => !filters.end || receipt.receipt_date <= filters.end)
        .filter((receipt) => !filters.status || receipt.status === filters.status)
        .filter((receipt) => !filters.employee || receipt.submitted_by === filters.employee || (claimsByReceipt.get(receipt.id) ?? []).some((claim) => claim.profile_id === filters.employee)),
    [claimsByReceipt, filters, scope.receipts]
  );
  const employeeSummaries = useMemo(
    () =>
      employees.map((employee) => {
        const employeeClaims = scope.claims.filter((claim) => claim.profile_id === employee.id && receiptById(scope.receipts, claim.receipt_id)?.status === "submitted");
        const receiptIds = new Set(employeeClaims.map((claim) => claim.receipt_id));
        const actualTotal = [...receiptIds].reduce((sum, receiptId) => sum + Number(receiptById(scope.receipts, receiptId)?.total_amount ?? 0), 0);
        const subsidyTotal = employeeClaims.reduce((sum, claim) => sum + Number(claim.subsidy_amount ?? 0), 0);
        return { employee, actualTotal, subsidyTotal, receiptIds: [...receiptIds] };
      }),
    [employees, scope.claims, scope.receipts]
  );
  const activeEmployee = employees.find((employee) => employee.id === activeEmployeeId);
  const activeEmployeeReceipts = activeEmployee
    ? scope.receipts.filter((receipt) => (claimsByReceipt.get(receipt.id) ?? []).some((claim) => claim.profile_id === activeEmployee.id))
    : [];

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
      await refresh();
    }
  }

  async function deleteReceipt(id: string) {
    const response = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
    const body = await response.json();
    setMessage(response.ok ? "單據已刪除" : body.error || "刪除失敗");
    if (response.ok) await refresh();
  }

  async function savePermissions(employeeId: string, claimantIds: string[]) {
    const response = await fetch("/api/admin/claimant-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_profile_id: employeeId, claimant_profile_ids: claimantIds })
    });
    const body = await response.json();
    setMessage(response.ok ? "合單名單已更新" : body.error || "合單名單更新失敗");
    if (response.ok) await refresh();
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
            <strong>部門行政</strong>
            <span>限定管理授權部門</span>
          </div>
        </div>
        <nav>
          <NavButton active={tab === "receipts"} icon={<ClipboardList size={16} />} label="單據列表" onClick={() => setTab("receipts")} />
          <NavButton active={tab === "payouts"} icon={<WalletCards size={16} />} label="員工請款" onClick={() => setTab("payouts")} />
          <NavButton active={tab === "stats"} icon={<ReceiptText size={16} />} label="單據統計" onClick={() => setTab("stats")} />
          <NavButton active={tab === "permissions"} icon={<UsersRound size={16} />} label="合單名單" onClick={() => setTab("permissions")} />
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

        <section className="metric-grid">
          <Metric label="可管理部門" value={scope.departments.length.toString()} />
          <Metric label="申請中單據" value={scope.receipts.filter((receipt) => receipt.status === "submitted").length.toString()} />
          <Metric label="待請款金額" value={money(scope.claims.filter((claim) => receiptById(scope.receipts, claim.receipt_id)?.status === "submitted").reduce((sum, claim) => sum + Number(claim.subsidy_amount || 0), 0))} />
        </section>

        {tab === "receipts" ? (
          <section className="panel">
            <ReceiptTable
              receipts={scope.receipts}
              claimsByReceipt={claimsByReceipt}
              attachmentsByReceipt={attachmentsByReceipt}
              profilesById={profilesById}
              departmentsById={departmentsById}
              onPaid={(id) => markReceipts([id], "paid")}
              onRejected={(id) => markReceipts([id], "rejected")}
              onDelete={deleteReceipt}
            />
          </section>
        ) : null}

        {tab === "payouts" ? (
          <section className="panel">
            <DataTable
              headers={["員工", "申請中金額", "待請款金額", ""]}
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
              <div className="filters">
                <label>起日<input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} /></label>
                <label>迄日<input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} /></label>
                <label>員工<select value={filters.employee} onChange={(event) => setFilters({ ...filters, employee: event.target.value })}><option value="">全部</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}</select></label>
                <label>狀態<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">全部</option><option value="submitted">申請中</option><option value="settled">已放款</option><option value="rejected">退單</option></select></label>
                <a className="primary-btn link-btn" href={`/api/reimbursements/export?${exportQuery}`}><Download size={16} /> 匯出 CSV</a>
                <a className="ghost-btn link-btn" href={`/api/admin/exports/photos?${exportQuery}`}><FileArchive size={16} /> 匯出照片 ZIP</a>
              </div>
            </div>
            <div className="panel">
              <ReceiptTable
                receipts={filteredReceipts}
                claimsByReceipt={claimsByReceipt}
                attachmentsByReceipt={attachmentsByReceipt}
                profilesById={profilesById}
                departmentsById={departmentsById}
              />
            </div>
          </section>
        ) : null}

        {tab === "permissions" ? (
          <section className="grid two">
            <div className="panel">
              <div className="panel-title"><Building2 size={17} /><h2>授權部門</h2></div>
              <div className="role-list">
                {scope.departments.map((department) => <div className="role-item" key={department.id}><strong>{department.code}</strong><span>{department.name}</span><span>{department.active ? "啟用" : "停用"}</span></div>)}
              </div>
            </div>
            <div className="panel">
              <div className="panel-title"><UsersRound size={17} /><h2>員工合單名單</h2></div>
              <div className="permission-list">
                {employees.map((employee) => {
                  const sameDepartmentEmployees = employees.filter((candidate) => candidate.department_id === employee.department_id && candidate.id !== employee.id);
                  const checked = new Set(scope.claimantPermissions.filter((permission) => permission.employee_profile_id === employee.id).map((permission) => permission.claimant_profile_id));
                  return <PermissionEditor key={employee.id} employee={employee} candidates={sameDepartmentEmployees} checked={checked} onSave={savePermissions} />;
                })}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      {activeEmployee ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setActiveEmployeeId("")}>
          <div className="modal-card wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="panel-title inline-title"><WalletCards size={17} /><h2>{activeEmployee.display_name} 請款管理</h2></div>
              <button className="icon-btn" title="關閉" onClick={() => setActiveEmployeeId("")}><X size={15} /></button>
            </div>
            <ReceiptTable
              receipts={activeEmployeeReceipts}
              claimsByReceipt={claimsByReceipt}
              attachmentsByReceipt={attachmentsByReceipt}
              profilesById={profilesById}
              departmentsById={departmentsById}
              onPaid={(id) => markReceipts([id], "paid")}
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

function ReceiptTable({ receipts, claimsByReceipt, attachmentsByReceipt, profilesById, departmentsById, onPaid, onRejected, onDelete }: {
  receipts: ReceiptRow[];
  claimsByReceipt: Map<string, Claim[]>;
  attachmentsByReceipt: Map<string, Attachment[]>;
  profilesById: Map<string, Profile>;
  departmentsById: Map<string, Department>;
  onPaid?: (id: string) => void;
  onRejected?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <DataTable
      headers={["日期", "部門", "申請人", "單據金額", "請款人", "請款金額", "狀態", "照片", ""]}
      rows={receipts.map((receipt) => {
        const claims = claimsByReceipt.get(receipt.id) ?? [];
        const attachments = attachmentsByReceipt.get(receipt.id) ?? [];
        return [
          receipt.receipt_date,
          departmentsById.get(receipt.department_id ?? "")?.name ?? "-",
          receipt.metadata?.applicant_name ?? profilesById.get(receipt.submitted_by)?.display_name ?? "-",
          money(Number(receipt.total_amount ?? 0)),
          claims.map((claim) => profilesById.get(claim.profile_id)?.display_name ?? "-").join("、"),
          money(claims.reduce((sum, claim) => sum + Number(claim.claimed_amount ?? 0), 0)),
          <span className={`status ${receipt.status === "settled" ? "paid" : receipt.status === "rejected" ? "rejected" : "claimed"}`} key="status">{statusLabels[receipt.status] ?? "申請中"}</span>,
          attachments.length ? attachments.map((attachment) => <a key={attachment.id} href={attachment.signed_url ?? "#"} target="_blank">{attachment.file_name ?? attachment.object_path.split("/").pop()}</a>) : "-",
          <div className="row-actions" key="actions">
            {onPaid && receipt.status !== "settled" ? <button className="ghost-btn compact" onClick={() => onPaid(receipt.id)}>已放款</button> : null}
            {onRejected && receipt.status === "submitted" ? <button className="ghost-btn compact" onClick={() => onRejected(receipt.id)}>退單</button> : null}
            {onDelete ? <button className="icon-btn" title="刪除" onClick={() => onDelete(receipt.id)}><Trash2 size={14} /></button> : null}
          </div>
        ];
      })}
      empty="沒有符合條件的單據"
    />
  );
}

function PermissionEditor({ employee, candidates, checked, onSave }: { employee: Profile; candidates: Profile[]; checked: Set<string>; onSave: (employeeId: string, claimantIds: string[]) => void }) {
  const [selected, setSelected] = useState(() => new Set(checked));
  useEffect(() => setSelected(new Set(checked)), [checked]);
  return (
    <div className="permission-card">
      <strong>{employee.display_name}</strong>
      <div className="checkbox-grid">
        {candidates.map((candidate) => (
          <label className="check-tile" key={candidate.id}>
            <input
              type="checkbox"
              checked={selected.has(candidate.id)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(candidate.id);
                else next.delete(candidate.id);
                setSelected(next);
              }}
            />
            <span>{candidate.display_name}</span>
          </label>
        ))}
        {!candidates.length ? <div className="empty compact">同部門沒有其他員工</div> : null}
      </div>
      <button className="primary-btn" onClick={() => onSave(employee.id, [...selected])}>儲存名單</button>
    </div>
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
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className={cellIndex === 7 ? "wrap-cell" : undefined} key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
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

function receiptById(receipts: ReceiptRow[], id: string) {
  return receipts.find((receipt) => receipt.id === id);
}

function tabTitle(tab: Tab) {
  return {
    receipts: "單據列表",
    payouts: "員工請款列表",
    stats: "單據統計",
    permissions: "合單名單維護"
  }[tab];
}
