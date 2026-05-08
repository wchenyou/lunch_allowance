"use client";

import { Camera, CheckCircle2, ClipboardList, ReceiptText, Upload, UsersRound } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { DAILY_SUBSIDY_LIMIT } from "@/app/lib/domain";
import type { Employee } from "@/app/lib/types";

const money = (value: number) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);

export default function EmployeeReceiptPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({
    profile_id: "",
    date: new Date().toISOString().slice(0, 10),
    merchant: "",
    receipt_no: "",
    total_amount: "",
    claim_amount: "",
    note: ""
  });
  const [message, setMessage] = useState("");
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.active), [employees]);

  useEffect(() => {
    fetch("/api/bootstrap")
      .then((response) => response.json())
      .then((data) => {
        const nextEmployees = data.employees ?? [];
        setEmployees(nextEmployees);
        setForm((current) => ({ ...current, profile_id: current.profile_id || nextEmployees.find((employee: Employee) => employee.active)?.employee_id || "" }));
      });
  }, []);

  async function submitReceipt(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const totalAmount = Number(form.total_amount);
    const claimAmount = Number(form.claim_amount || form.total_amount);
    const response = await fetch("/api/employee/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: form.profile_id,
        date: form.date,
        merchant: form.merchant,
        receipt_no: form.receipt_no,
        total_amount: totalAmount,
        note: form.note,
        allocations: [{ employee_id: form.profile_id, amount: claimAmount, note: form.note }]
      })
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "送出失敗");
      return;
    }
    setMessage("已送出給行政審核");
    setForm((current) => ({ ...current, merchant: "", receipt_no: "", total_amount: "", claim_amount: "", note: "" }));
  }

  return (
    <main className="mobile-shell">
      <section className="mobile-screen">
        <header className="mobile-header">
          <div>
            <p className="eyebrow">員工端 / 手機優先</p>
            <h1>午餐收據上傳</h1>
          </div>
          <div className="mobile-avatar">午</div>
        </header>

        <section className="mobile-summary">
          <div>
            <span>今日剩餘補助</span>
            <strong>{money(DAILY_SUBSIDY_LIMIT)}</strong>
          </div>
          <CheckCircle2 size={22} />
        </section>

        <form className="mobile-form" onSubmit={submitReceipt}>
          <label>
            員工
            <select value={form.profile_id} onChange={(event) => setForm({ ...form, profile_id: event.target.value })} required>
              <option value="" disabled>
                選擇員工
              </option>
              {activeEmployees.map((employee) => (
                <option key={employee.employee_id} value={employee.employee_id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            收據日期
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required />
          </label>
          <label>
            店家 / 發票號碼
            <input
              placeholder="例如：福勝亭"
              value={form.merchant}
              onChange={(event) => setForm({ ...form, merchant: event.target.value })}
            />
          </label>
          <label>
            發票號碼
            <input placeholder="AB-12345678" value={form.receipt_no} onChange={(event) => setForm({ ...form, receipt_no: event.target.value })} />
          </label>
          <label>
            單據總金額
            <input
              type="number"
              min="1"
              placeholder="輸入收據金額"
              value={form.total_amount}
              onChange={(event) => setForm({ ...form, total_amount: event.target.value, claim_amount: form.claim_amount || event.target.value })}
              required
            />
          </label>

          <div className="upload-zone">
            <Camera size={26} />
            <div>
              <strong>拍照或上傳收據</strong>
              <span>圖片會存到 Supabase Storage，不寫入資料庫。</span>
            </div>
            <button type="button" className="icon-btn" title="上傳">
              <Upload size={16} />
            </button>
          </div>

          <div className="mobile-section-title">
            <UsersRound size={16} />
            <span>多人同單據請款</span>
          </div>
          <div className="claim-card">
            <select value={form.profile_id} onChange={(event) => setForm({ ...form, profile_id: event.target.value })} required>
              <option value="">選擇請款人</option>
              {activeEmployees.map((employee) => (
                <option key={employee.employee_id} value={employee.employee_id}>
                  {employee.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              placeholder="個人請款金額"
              value={form.claim_amount}
              onChange={(event) => setForm({ ...form, claim_amount: event.target.value })}
              required
            />
            <p>每人每日最多補助 {money(DAILY_SUBSIDY_LIMIT)}，超過部分會自動標示不補助。</p>
          </div>

          {message ? <p className="form-message">{message}</p> : null}

          <button className="primary-btn wide">
            <ReceiptText size={17} />
            送出給行政審核
          </button>
        </form>

        <nav className="mobile-tabs">
          <Link className="active" href="/employee">
            <Camera size={17} />
            上傳
          </Link>
          <Link href="/">
            <ClipboardList size={17} />
            紀錄
          </Link>
        </nav>
      </section>
    </main>
  );
}
