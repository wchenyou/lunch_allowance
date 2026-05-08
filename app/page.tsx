"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  LayoutDashboard,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Users,
  WalletCards
} from "lucide-react";
import { Allocation, DAILY_LIMIT, Database, Employee, Receipt, ReceiptInput, ReimbursementStatus } from "./lib/types";
import { buildReimbursementReport, getReceiptAllocationTotal } from "./lib/calculations";

type Tab = "dashboard" | "receipts" | "employees" | "reimbursements";
type ReceiptForm = ReceiptInput & { receipt_id?: string };

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);

const emptyReceipt = (date = todayIso(), employees: Employee[] = []): ReceiptForm => ({
  date,
  payer_employee_id: employees.find((employee) => employee.active)?.employee_id ?? "",
  merchant: "",
  total_amount: 0,
  receipt_no: "",
  note: "",
  reimbursement_status: "pending",
  allocations: [{ employee_id: employees.find((employee) => employee.active)?.employee_id ?? "", amount: 0, note: "" }]
});

export default function HomePage() {
  const [db, setDb] = useState<Database>({ employees: [], receipts: [], allocations: [] });
  const [tab, setTab] = useState<Tab>("dashboard");
  const [date, setDate] = useState(todayIso());
  const [range, setRange] = useState({ start: todayIso(), end: todayIso() });
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>(emptyReceipt());
  const [employeeForm, setEmployeeForm] = useState({ employee_id: "", name: "", active: true, note: "" });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const activeEmployees = useMemo(() => db.employees.filter((employee) => employee.active), [db.employees]);
  const employeesById = useMemo(() => new Map(db.employees.map((employee) => [employee.employee_id, employee])), [db.employees]);
  const receiptsForDate = useMemo(() => db.receipts.filter((receipt) => receipt.date === date), [db.receipts, date]);
  const report = useMemo(() => buildReimbursementReport(db, range.start, range.end), [db, range]);
  const dayReport = useMemo(() => buildReimbursementReport(db, date, date), [db, date]);

  useEffect(() => {
    fetch("/api/bootstrap")
      .then((response) => response.json())
      .then((data) => {
        setDb(data);
        setReceiptForm(emptyReceipt(todayIso(), data.employees ?? []));
      })
      .finally(() => setLoading(false));
  }, []);

  async function mutate(url: string, options: RequestInit, okMessage: string) {
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "操作失敗");
      return;
    }
    setDb(body);
    setReceiptForm(emptyReceipt(date, body.employees ?? []));
    setEmployeeForm({ employee_id: "", name: "", active: true, note: "" });
    setMessage(okMessage);
  }

  function updateAllocation(index: number, patch: Partial<ReceiptForm["allocations"][number]>) {
    setReceiptForm((current) => ({
      ...current,
      allocations: current.allocations.map((allocation, allocationIndex) => (allocationIndex === index ? { ...allocation, ...patch } : allocation))
    }));
  }

  function editReceipt(receipt: Receipt) {
    setTab("dashboard");
    setDate(receipt.date);
    setReceiptForm({
      ...receipt,
      total_amount: receipt.total_amount,
      allocations: db.allocations
        .filter((allocation) => allocation.receipt_id === receipt.receipt_id)
        .map((allocation) => ({ employee_id: allocation.employee_id, amount: allocation.amount, note: allocation.note }))
    });
  }

  function submitReceipt(event: FormEvent) {
    event.preventDefault();
    const url = receiptForm.receipt_id ? `/api/receipts/${receiptForm.receipt_id}` : "/api/receipts";
    mutate(url, { method: receiptForm.receipt_id ? "PUT" : "POST", body: JSON.stringify(receiptForm) }, "收據已儲存");
  }

  function submitEmployee(event: FormEvent) {
    event.preventDefault();
    mutate("/api/employees", { method: "POST", body: JSON.stringify(employeeForm) }, "員工資料已儲存");
  }

  const filteredReceipts = db.receipts
    .filter((receipt) => (!range.start || receipt.date >= range.start) && (!range.end || receipt.date <= range.end))
    .filter((receipt) => {
      const payer = employeesById.get(receipt.payer_employee_id)?.name ?? "";
      return `${receipt.date} ${payer} ${receipt.merchant} ${receipt.receipt_no}`.toLowerCase().includes(query.toLowerCase());
    });

  if (loading) return <main className="center-state">載入中...</main>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">午</div>
          <div>
            <strong>Lunch Admin</strong>
            <span>Subsidy MVP</span>
          </div>
        </div>
        <nav>
          <NavButton icon={<LayoutDashboard size={16} />} label="今日登記" active={tab === "dashboard"} onClick={() => setTab("dashboard")} />
          <NavButton icon={<ReceiptText size={16} />} label="收據清單" active={tab === "receipts"} onClick={() => setTab("receipts")} />
          <NavButton icon={<Users size={16} />} label="員工管理" active={tab === "employees"} onClick={() => setTab("employees")} />
          <NavButton icon={<WalletCards size={16} />} label="結算匯出" active={tab === "reimbursements"} onClick={() => setTab("reimbursements")} />
        </nav>
        <button className="ghost-btn logout" onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => (window.location.href = "/login"))}>
          登出
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">每日上限 {money(DAILY_LIMIT)}，少不補發</p>
            <h1>{tabTitle(tab)}</h1>
          </div>
          {message ? <div className="toast">{message}</div> : null}
        </header>

        {tab === "dashboard" ? (
          <section className="grid two">
            <div className="panel">
              <PanelTitle icon={<CalendarDays size={17} />} title="新增收據" />
              <form className="form-grid" onSubmit={submitReceipt}>
                <label>
                  日期
                  <input type="date" value={receiptForm.date} onChange={(event) => setReceiptForm({ ...receiptForm, date: event.target.value })} required />
                </label>
                <label>
                  付款人
                  <select
                    value={receiptForm.payer_employee_id}
                    onChange={(event) => setReceiptForm({ ...receiptForm, payer_employee_id: event.target.value })}
                    required
                  >
                    <option value="">選擇付款人</option>
                    {activeEmployees.map((employee) => (
                      <option key={employee.employee_id} value={employee.employee_id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  金額
                  <input
                    type="number"
                    min="1"
                    value={receiptForm.total_amount || ""}
                    onChange={(event) => setReceiptForm({ ...receiptForm, total_amount: Number(event.target.value) })}
                    required
                  />
                </label>
                <label>
                  店家
                  <input value={receiptForm.merchant} onChange={(event) => setReceiptForm({ ...receiptForm, merchant: event.target.value })} />
                </label>
                <label>
                  收據號碼
                  <input value={receiptForm.receipt_no} onChange={(event) => setReceiptForm({ ...receiptForm, receipt_no: event.target.value })} />
                </label>
                <label>
                  備註
                  <input value={receiptForm.note} onChange={(event) => setReceiptForm({ ...receiptForm, note: event.target.value })} />
                </label>
                <div className="allocations">
                  <div className="section-row">
                    <span>分攤明細</span>
                    <button
                      type="button"
                      className="ghost-btn compact"
                      onClick={() => setReceiptForm({ ...receiptForm, allocations: [...receiptForm.allocations, { employee_id: "", amount: 0, note: "" }] })}
                    >
                      <Plus size={14} /> 新增
                    </button>
                  </div>
                  {receiptForm.allocations.map((allocation, index) => (
                    <div className="allocation-row" key={index}>
                      <select value={allocation.employee_id} onChange={(event) => updateAllocation(index, { employee_id: event.target.value })} required>
                        <option value="">員工</option>
                        {activeEmployees.map((employee) => (
                          <option key={employee.employee_id} value={employee.employee_id}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        placeholder="分攤金額"
                        value={allocation.amount || ""}
                        onChange={(event) => updateAllocation(index, { amount: Number(event.target.value) })}
                        required
                      />
                      <input placeholder="備註" value={allocation.note ?? ""} onChange={(event) => updateAllocation(index, { note: event.target.value })} />
                      <button
                        className="icon-btn"
                        type="button"
                        title="移除分攤"
                        onClick={() => setReceiptForm({ ...receiptForm, allocations: receiptForm.allocations.filter((_, i) => i !== index) })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="form-actions">
                  {receiptForm.receipt_id ? (
                    <button type="button" className="ghost-btn" onClick={() => setReceiptForm(emptyReceipt(date, db.employees))}>
                      取消編輯
                    </button>
                  ) : null}
                  <button className="primary-btn">
                    <FileText size={16} />
                    {receiptForm.receipt_id ? "更新收據" : "建立收據"}
                  </button>
                </div>
              </form>
            </div>

            <div className="stack">
              <div className="panel">
                <PanelTitle icon={<CalendarDays size={17} />} title="今日狀態" />
                <input className="date-pick" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                <div className="metric-grid">
                  <Metric label="收據" value={receiptsForDate.length.toString()} />
                  <Metric label="可請款" value={money(dayReport.employeeDays.reduce((sum, item) => sum + item.reimbursable, 0))} />
                  <Metric label="超額" value={money(dayReport.employeeDays.reduce((sum, item) => sum + item.over, 0))} />
                </div>
                <DataTable
                  headers={["員工", "登記", "可請款", "超額", "未用"]}
                  rows={dayReport.employeeDays.map((item) => [item.employee_name, money(item.total), money(item.reimbursable), money(item.over), money(item.unused)])}
                  empty="今天還沒有分攤資料"
                />
              </div>
              <div className="panel">
                <PanelTitle icon={<ReceiptText size={17} />} title="今日收據" />
                <ReceiptRows receipts={receiptsForDate} allocations={db.allocations} employeesById={employeesById} onEdit={editReceipt} onDelete={(id) => mutate(`/api/receipts/${id}`, { method: "DELETE" }, "收據已刪除")} />
              </div>
            </div>
          </section>
        ) : null}

        {tab === "receipts" ? (
          <section className="panel">
            <div className="filters">
              <label>
                起日
                <input type="date" value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} />
              </label>
              <label>
                迄日
                <input type="date" value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} />
              </label>
              <div className="search-box">
                <Search size={15} />
                <input placeholder="搜尋店家、付款人、號碼" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
            </div>
            <ReceiptRows receipts={filteredReceipts} allocations={db.allocations} employeesById={employeesById} onEdit={editReceipt} onDelete={(id) => mutate(`/api/receipts/${id}`, { method: "DELETE" }, "收據已刪除")} />
          </section>
        ) : null}

        {tab === "employees" ? (
          <section className="grid two narrow">
            <div className="panel">
              <PanelTitle icon={<Users size={17} />} title={employeeForm.employee_id ? "編輯員工" : "新增員工"} />
              <form className="form-grid single" onSubmit={submitEmployee}>
                <label>
                  姓名
                  <input value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} required />
                </label>
                <label>
                  備註
                  <input value={employeeForm.note} onChange={(event) => setEmployeeForm({ ...employeeForm, note: event.target.value })} />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={employeeForm.active} onChange={(event) => setEmployeeForm({ ...employeeForm, active: event.target.checked })} />
                  啟用
                </label>
                <button className="primary-btn">{employeeForm.employee_id ? "更新員工" : "新增員工"}</button>
              </form>
            </div>
            <div className="panel">
              <PanelTitle icon={<Users size={17} />} title="員工列表" />
              <DataTable
                headers={["姓名", "狀態", "備註", ""]}
                rows={db.employees.map((employee) => [
                  employee.name,
                  employee.active ? "啟用" : "停用",
                  employee.note,
                  <button
                    className="ghost-btn compact"
                    key={employee.employee_id}
                    onClick={() => setEmployeeForm({ employee_id: employee.employee_id, name: employee.name, active: employee.active, note: employee.note })}
                  >
                    <Edit3 size={14} /> 編輯
                  </button>
                ])}
                empty="尚未建立員工"
              />
            </div>
          </section>
        ) : null}

        {tab === "reimbursements" ? (
          <section className="stack">
            <div className="panel">
              <div className="filters between">
                <label>
                  起日
                  <input type="date" value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} />
                </label>
                <label>
                  迄日
                  <input type="date" value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} />
                </label>
                <a className="primary-btn link-btn" href={`/api/reimbursements/export?start=${range.start}&end=${range.end}`}>
                  <Download size={16} /> 匯出 CSV
                </a>
                <button
                  className="ghost-btn"
                  onClick={() => mutate("/api/reimbursements/mark", { method: "POST", body: JSON.stringify({ receiptIds: filteredReceipts.map((receipt) => receipt.receipt_id), status: "claimed" }) }, "已標記為已請款")}
                >
                  <CheckCircle2 size={16} /> 標記範圍已請款
                </button>
              </div>
              <div className="metric-grid">
                <Metric label="付款人" value={report.payerSummaries.length.toString()} />
                <Metric label="應 reimburse" value={money(report.payerSummaries.reduce((sum, item) => sum + item.reimbursable, 0))} />
                <Metric label="分攤筆數" value={report.allocations.length.toString()} />
              </div>
            </div>
            <div className="grid two">
              <div className="panel">
                <PanelTitle icon={<WalletCards size={17} />} title="依付款人彙總" />
                <DataTable headers={["付款人", "收據", "分攤", "應付"]} rows={report.payerSummaries.map((item) => [item.payer_name, item.receipt_count, item.allocation_count, money(item.reimbursable)])} empty="範圍內沒有資料" />
              </div>
              <div className="panel">
                <PanelTitle icon={<Users size={17} />} title="員工每日補助" />
                <DataTable headers={["日期", "員工", "登記", "補助", "超額"]} rows={report.employeeDays.map((item) => [item.date, item.employee_name, money(item.total), money(item.reimbursable), money(item.over)])} empty="範圍內沒有資料" />
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? "nav-btn active" : "nav-btn"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DataTable({ headers, rows, empty }: { headers: string[]; rows: Array<Array<ReactNode>>; empty: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptRows({
  receipts,
  allocations,
  employeesById,
  onEdit,
  onDelete
}: {
  receipts: Receipt[];
  allocations: Allocation[];
  employeesById: Map<string, Employee>;
  onEdit: (receipt: Receipt) => void;
  onDelete: (id: string) => void;
}) {
  const statusLabel: Record<ReimbursementStatus, string> = { pending: "未請款", claimed: "已請款", paid: "已結清" };
  return (
    <DataTable
      headers={["日期", "付款人", "店家", "總金額", "分攤合計", "狀態", ""]}
      rows={receipts.map((receipt) => [
        receipt.date,
        employeesById.get(receipt.payer_employee_id)?.name ?? "Unknown",
        receipt.merchant || "-",
        money(receipt.total_amount),
        money(getReceiptAllocationTotal(receipt, allocations)),
        <span className={`status ${receipt.reimbursement_status}`} key="status">
          {statusLabel[receipt.reimbursement_status]}
        </span>,
        <div className="row-actions" key="actions">
          <button className="icon-btn" title="編輯" onClick={() => onEdit(receipt)}>
            <Edit3 size={14} />
          </button>
          <button className="icon-btn" title="刪除" onClick={() => onDelete(receipt.receipt_id)}>
            <Trash2 size={14} />
          </button>
        </div>
      ])}
      empty="沒有符合條件的收據"
    />
  );
}

function tabTitle(tab: Tab) {
  return {
    dashboard: "Dashboard / 今日登記",
    receipts: "Receipts / 收據清單",
    employees: "Employees / 員工管理",
    reimbursements: "Reimbursements / 結算匯出"
  }[tab];
}
