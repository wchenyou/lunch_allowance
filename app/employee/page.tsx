"use client";

import { Camera, CheckCircle2, KeyRound, ReceiptText, Upload, UsersRound } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { DAILY_SUBSIDY_LIMIT } from "@/app/lib/domain";
import { createSupabaseBrowserClient } from "@/app/lib/supabase/client";
import type { Employee, Receipt, ReceiptAttachment } from "@/app/lib/types";

const money = (value: number) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);
const todayIso = () => new Date().toISOString().slice(0, 10);

type ClaimInput = { employee_id: string; amount: string };
type Summary = { submittedTotal: number; paidTotal: number; unpaidTotal: number };

export default function EmployeeReceiptPage() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [allowedClaimants, setAllowedClaimants] = useState<Employee[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [attachments, setAttachments] = useState<ReceiptAttachment[]>([]);
  const [summary, setSummary] = useState<Summary>({ submittedTotal: 0, paidTotal: 0, unpaidTotal: 0 });
  const [form, setForm] = useState({
    date: todayIso(),
    merchant: "",
    receipt_no: "",
    total_amount: "",
    note: ""
  });
  const [claimInputs, setClaimInputs] = useState<ClaimInput[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [passwordForm, setPasswordForm] = useState({ current_password: "", next_password: "" });

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const data = await response.json();
    const currentEmployee = data.employees?.[0] ?? null;
    setEmployee(currentEmployee);
    setAllowedClaimants(data.allowedClaimants ?? data.employees ?? []);
    setReceipts(data.receipts ?? []);
    setAttachments(data.attachments ?? []);
    setSummary(data.summary ?? { submittedTotal: 0, paidTotal: 0, unpaidTotal: 0 });
    if (currentEmployee) {
      setClaimInputs((current) => current.length ? current : [{ employee_id: currentEmployee.employee_id, amount: "" }]);
    }
  }

  const activeClaimants = useMemo(() => allowedClaimants.filter((claimant) => claimant.active), [allowedClaimants]);
  const selectedClaimIds = useMemo(() => new Set(claimInputs.map((claim) => claim.employee_id)), [claimInputs]);
  const receiptAttachments = useMemo(() => new Map(attachments.map((attachment) => [attachment.receipt_id, attachment])), [attachments]);
  const statusLabel = (status: Receipt["reimbursement_status"]) => (status === "paid" ? "已放款" : status === "rejected" ? "退單" : "申請中");

  function toggleClaimant(employeeId: string, checked: boolean) {
    if (employeeId === employee?.employee_id) return;
    setClaimInputs((current) =>
      checked ? [...current, { employee_id: employeeId, amount: "" }] : current.filter((claim) => claim.employee_id !== employeeId)
    );
  }

  function updateClaimAmount(employeeId: string, amount: string) {
    setClaimInputs((current) => current.map((claim) => (claim.employee_id === employeeId ? { ...claim, amount } : claim)));
  }

  async function submitReceipt(event: FormEvent) {
    event.preventDefault();
    if (!employee) return;
    if (!imageFile) {
      setMessage("請先拍照或選擇單據照片");
      return;
    }
    setMessage("");
    const totalAmount = Number(form.total_amount);
    const validClaims = claimInputs
      .map((claim) => ({ employee_id: claim.employee_id, amount: Number(claim.amount) }))
      .filter((claim) => claim.employee_id && Number.isFinite(claim.amount) && claim.amount > 0);
    if (!validClaims.some((claim) => claim.employee_id === employee.employee_id)) {
      setMessage("請款人必須包含申請人自己");
      return;
    }

    const response = await fetch("/api/employee/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: employee.employee_id,
        date: form.date,
        merchant: form.merchant,
        receipt_no: form.receipt_no,
        total_amount: totalAmount,
        note: form.note,
        allocations: validClaims.map((claim) => ({ employee_id: claim.employee_id, amount: claim.amount, note: form.note }))
      })
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "送出失敗");
      return;
    }

    const receipt = body.receipt as Receipt | undefined;
    if (receipt?.receipt_id) {
      await uploadReceiptImage(receipt.receipt_id, imageFile);
    }
    setMessage("已送出給行政審核");
    setForm((current) => ({ ...current, merchant: "", receipt_no: "", total_amount: "", note: "" }));
    setImageFile(null);
    setClaimInputs([{ employee_id: employee.employee_id, amount: "" }]);
    await refresh();
  }

  async function uploadReceiptImage(receiptId: string, file: File) {
    if (!employee) return;
    const compressed = await compressImage(file);
    const fileName = nextReceiptFileName(employee.name, form.date);
    const signResponse = await fetch("/api/employee/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: employee.employee_id, receipt_id: receiptId, content_type: compressed.type, file_name: fileName })
    });
    const signed = await signResponse.json();
    if (!signResponse.ok) throw new Error(signed.error || "照片上傳授權失敗");
    const supabase = createSupabaseBrowserClient();
    const uploaded = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.object_path, signed.token, compressed);
    if (uploaded.error) throw uploaded.error;
    const completeResponse = await fetch("/api/employee/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt_id: receiptId, object_path: signed.object_path, content_type: compressed.type, size_bytes: compressed.size })
    });
    if (!completeResponse.ok) {
      const body = await completeResponse.json();
      throw new Error(body.error || "照片紀錄失敗");
    }
  }

  function nextReceiptFileName(employeeName: string, date: string) {
    const datePart = date.replaceAll("-", "");
    const safeName = employeeName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");
    const existingCount = attachments.filter((attachment) => attachment.file_name.startsWith(`${datePart}_${safeName}_`)).length;
    return `${datePart}_${safeName}_${String(existingCount + 1).padStart(2, "0")}.jpg`;
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
    setMessage("密碼已更新");
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
            <span>已送出 / 已發放 / 未發放</span>
            <strong>{money(summary.submittedTotal)}</strong>
            <small>{money(summary.paidTotal)} / {money(summary.unpaidTotal)}</small>
          </div>
          <CheckCircle2 size={22} />
        </section>

        <form className="mobile-form" onSubmit={submitReceipt}>
          <label>
            申請人
            <input value={employee?.name ?? ""} readOnly />
          </label>
          <label>
            申請日期
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required />
          </label>
          <label>
            店家
            <input placeholder="例如：福勝亭" value={form.merchant} onChange={(event) => setForm({ ...form, merchant: event.target.value })} />
          </label>
          <label>
            發票號碼
            <input placeholder="AB-12345678" value={form.receipt_no} onChange={(event) => setForm({ ...form, receipt_no: event.target.value })} />
          </label>
          <label>
            單據總金額
            <input type="number" min="1" value={form.total_amount} onChange={(event) => setForm({ ...form, total_amount: event.target.value })} required />
          </label>
          <label>
            備註
            <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>

          <label className="upload-zone">
            <Camera size={26} />
            <div>
              <strong>{imageFile ? imageFile.name : "拍照或上傳單據"}</strong>
              <span>送出時會自動壓縮並命名照片。</span>
            </div>
            <Upload size={16} />
            <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
          </label>

          <div className="mobile-section-title">
            <UsersRound size={16} />
            <span>請款人與金額</span>
          </div>
          <div className="claim-card">
            {activeClaimants.map((claimant) => (
              <div className="claimant-row" key={claimant.employee_id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedClaimIds.has(claimant.employee_id)}
                    disabled={claimant.employee_id === employee?.employee_id}
                    onChange={(event) => toggleClaimant(claimant.employee_id, event.target.checked)}
                  />
                  {claimant.name}
                </label>
                {selectedClaimIds.has(claimant.employee_id) ? (
                  <input
                    type="number"
                    min="1"
                    placeholder="請款金額"
                    value={claimInputs.find((claim) => claim.employee_id === claimant.employee_id)?.amount ?? ""}
                    onChange={(event) => updateClaimAmount(claimant.employee_id, event.target.value)}
                    required
                  />
                ) : null}
              </div>
            ))}
            <p>每人每日最多兩張單據，合併補助上限 {money(DAILY_SUBSIDY_LIMIT)}。</p>
          </div>

          {message ? <p className="form-message">{message}</p> : null}

          <button className="primary-btn wide">
            <ReceiptText size={17} />
            送出給行政審核
          </button>
        </form>

        <section className="password-panel">
          <div className="mobile-section-title">
            <ReceiptText size={16} />
            <span>我的單據狀態</span>
          </div>
          <div className="mini-list">
            {receipts.map((receipt) => {
              const claimNames = receipt.claimant_names?.length ? receipt.claimant_names.join("、") : employee?.name ?? "-";
              const attachment = receiptAttachments.get(receipt.receipt_id);
              return (
                <div className="mini-list-item" key={receipt.receipt_id}>
                  <strong>{receipt.date} {money(receipt.total_amount)}</strong>
                  <span>{claimNames} · {statusLabel(receipt.reimbursement_status)}</span>
                  {attachment?.signed_url ? <a href={attachment.signed_url} target="_blank">查看照片</a> : null}
                </div>
              );
            })}
            {!receipts.length ? <p className="form-message">尚未送出單據</p> : null}
          </div>
        </section>

        <form className="mobile-form password-panel" onSubmit={changePassword}>
          <div className="mobile-section-title">
            <KeyRound size={16} />
            <span>更改登入密碼</span>
          </div>
          <label>
            目前密碼
            <input type="password" value={passwordForm.current_password} onChange={(event) => setPasswordForm({ ...passwordForm, current_password: event.target.value })} />
          </label>
          <label>
            新密碼
            <input type="password" minLength={8} value={passwordForm.next_password} onChange={(event) => setPasswordForm({ ...passwordForm, next_password: event.target.value })} required />
          </label>
          <button className="ghost-btn wide" type="submit">
            更新密碼
          </button>
        </form>

        <nav className="mobile-tabs">
          <Link className="active" href="/employee">
            <Camera size={17} />
            上傳
          </Link>
        </nav>
      </section>
    </main>
  );
}

async function compressImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value ?? file), "image/jpeg", 0.78));
  return new File([blob], "receipt.jpg", { type: "image/jpeg" });
}
