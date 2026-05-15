"use client";

import { Camera, KeyRound, LogOut, Menu, ReceiptText, Upload, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { calculateDailyClaimSubsidies } from "@/app/lib/calculations";
import { DAILY_SUBSIDY_LIMIT, Department } from "@/app/lib/domain";
import { createSupabaseBrowserClient } from "@/app/lib/supabase/client";
import type { Allocation, Employee, Receipt, ReceiptAttachment } from "@/app/lib/types";

const money = (value: number) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);
const todayIso = () => new Date().toISOString().slice(0, 10);

type ClaimInput = { employee_id: string; amount: string };
type Summary = { submittedTotal: number; paidTotal: number; unpaidTotal: number; pendingCount: number; pendingTotalAmount: number; pendingClaimableAmount: number };

export default function EmployeeReceiptPage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [allowedClaimants, setAllowedClaimants] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [, setAllocations] = useState<Allocation[]>([]);
  const [attachments, setAttachments] = useState<ReceiptAttachment[]>([]);
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary>({ submittedTotal: 0, paidTotal: 0, unpaidTotal: 0, pendingCount: 0, pendingTotalAmount: 0, pendingClaimableAmount: 0 });
  const [hasMoreReceipts, setHasMoreReceipts] = useState(false);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(false);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [form, setForm] = useState({
    date: todayIso(),
    merchant: "",
    receipt_no: "",
    total_amount: "",
    note: "",
    category: "餐費補助"
  });
  const [isMultiClaim, setIsMultiClaim] = useState(false);
  const [claimInputs, setClaimInputs] = useState<ClaimInput[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;
  const [passwordForm, setPasswordForm] = useState({ next_password: "", confirm_password: "" });
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const data = await response.json();
    const currentEmployee = data.employees?.[0] ?? null;
    setEmployee(currentEmployee);
    setAllowedClaimants(data.allowedClaimants ?? data.employees ?? []);
    setDepartments(data.departments ?? []);
    const sortedReceipts = (data.receipts ?? []).sort((a: Receipt, b: Receipt) => {
      const aRejected = a.reimbursement_status === "rejected";
      const bRejected = b.reimbursement_status === "rejected";
      if (aRejected && !bRejected) return -1;
      if (!aRejected && bRejected) return 1;
      return 0;
    });
    setReceipts(sortedReceipts);
    setPage(0);
    setAllocations(data.allocations ?? []);
    setAttachments(data.attachments ?? []);
    setSummary(data.summary ?? { submittedTotal: 0, paidTotal: 0, unpaidTotal: 0, pendingCount: 0, pendingTotalAmount: 0, pendingClaimableAmount: 0 });
    setHasMoreReceipts(Boolean(data.hasMore));
    setDirectoryLoaded(false);
    if (currentEmployee) {
      setClaimInputs((current) => current.length ? current : [{ employee_id: currentEmployee.employee_id, amount: "" }]);
    }
  }

  async function loadReceiptPage(offset: number) {
    if (isLoadingReceipts) return false;
    setIsLoadingReceipts(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ mode: "receipts", offset: String(offset), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/bootstrap?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || "單據載入失敗");
        return false;
      }
      const nextReceipts = (data.receipts ?? []) as Receipt[];
      const nextAllocations = (data.allocations ?? []) as Allocation[];
      const nextAttachments = (data.attachments ?? []) as ReceiptAttachment[];
      const nextReceiptIds = new Set(nextReceipts.map((receipt) => receipt.receipt_id));
      const nextAllocationIds = new Set(nextAllocations.map((allocation) => allocation.allocation_id));
      const nextAttachmentIds = new Set(nextAttachments.map((attachment) => attachment.attachment_id));
      setReceipts((current) => sortReceipts([...current.filter((receipt) => !nextReceiptIds.has(receipt.receipt_id)), ...nextReceipts]));
      setAllocations((current) => [...current.filter((allocation) => !nextAllocationIds.has(allocation.allocation_id)), ...nextAllocations]);
      setAttachments((current) => [...current.filter((attachment) => !nextAttachmentIds.has(attachment.attachment_id)), ...nextAttachments]);
      setHasMoreReceipts(Boolean(data.hasMore));
      return true;
    } finally {
      setIsLoadingReceipts(false);
    }
  }

  async function loadDirectory() {
    if (directoryLoaded) return;
    const response = await fetch("/api/bootstrap?mode=directory", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "合單名單載入失敗");
      return;
    }
    setAllowedClaimants(data.allowedClaimants ?? data.employees ?? []);
    setDepartments(data.departments ?? []);
    setDirectoryLoaded(true);
  }

  async function openUploadModal() {
    setUploadModalOpen(true);
    setMessage("");
    void loadDirectory();
  }

  async function goToNextPage() {
    const nextPage = page + 1;
    if (nextPage * PAGE_SIZE >= receipts.length) {
      if (!hasMoreReceipts) return;
      const loaded = await loadReceiptPage(receipts.length);
      if (!loaded) return;
    }
    setPage(nextPage);
  }

  const activeClaimants = useMemo(() => allowedClaimants.filter((claimant) => claimant.active), [allowedClaimants]);
  const selectedClaimIds = useMemo(() => new Set(claimInputs.map((claim) => claim.employee_id)), [claimInputs]);
  const receiptAttachments = useMemo(() => new Map(attachments.map((attachment) => [attachment.receipt_id, attachment])), [attachments]);
  const statusLabel = (status: Receipt["reimbursement_status"]) => (status === "paid" ? "已放款" : status === "rejected" ? "退單" : "申請中");

  async function openAttachment(attachment: ReceiptAttachment) {
    const cachedUrl = signedUrlCache[attachment.attachment_id] ?? attachment.signed_url;
    if (cachedUrl) {
      window.open(cachedUrl, "_blank");
      return;
    }
    const response = await fetch(`/api/attachments/${attachment.attachment_id}/sign`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.signed_url) {
      setMessage(body.error || "照片連結產生失敗");
      return;
    }
    setSignedUrlCache((current) => ({ ...current, [attachment.attachment_id]: body.signed_url }));
    window.open(body.signed_url, "_blank");
  }

  function toggleClaimant(employeeId: string, checked: boolean) {
    if (employeeId === employee?.employee_id) return;
    setClaimInputs((current) =>
      checked ? [...current, { employee_id: employeeId, amount: "" }] : current.filter((claim) => claim.employee_id !== employeeId)
    );
  }

  function updateClaimAmount(employeeId: string, amount: string) {
    setClaimInputs((current) => current.map((claim) => (claim.employee_id === employeeId ? { ...claim, amount } : claim)));
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  async function handleDeleteReceipt(receiptId: string) {
    if (!employee) return;
    if (!confirm("確定要刪除這張單據嗎？")) return;
    const response = await fetch(`/api/employee/receipts/${receiptId}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      alert(body.error || "刪除失敗");
      return;
    }
    setReceipts((current) => {
      const nextReceipts = current.filter((receipt) => receipt.receipt_id !== receiptId);
      setAllocations((currentAllocations) => {
        const nextAllocations = currentAllocations.filter((allocation) => allocation.receipt_id !== receiptId);
        setSummary(buildSummary(employee.employee_id, nextReceipts, nextAllocations));
        return nextAllocations;
      });
      return nextReceipts;
    });
    setAttachments((current) => current.filter((attachment) => attachment.receipt_id !== receiptId));
  }

  async function submitReceipt(event: FormEvent) {
    event.preventDefault();
    if (!employee) return;
    if (isSubmitting) return;
    if (!imageFile) {
      setMessage("請先拍照或選擇單據照片");
      return;
    }
    setMessage("");
    setIsSubmitting(true);
    const totalAmount = Number(form.total_amount);
    
    let validClaims;
    if (isMultiClaim) {
      validClaims = claimInputs
        .map((claim) => ({ employee_id: claim.employee_id, amount: Number(claim.amount) }))
        .filter((claim) => claim.employee_id && Number.isFinite(claim.amount) && claim.amount > 0);
      if (!validClaims.some((claim) => claim.employee_id === employee.employee_id)) {
        setMessage("請款人必須包含申請人自己");
        setIsSubmitting(false);
        return;
      }
    } else {
      validClaims = [{ employee_id: employee.employee_id, amount: totalAmount }];
    }

    const compressedImagePromise = compressImage(imageFile);
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
        category: form.category,
        allocations: validClaims.map((claim) => ({ employee_id: claim.employee_id, amount: claim.amount, note: form.note }))
      })
    });
    const body = await response.json();
    if (!response.ok) {
      compressedImagePromise.catch(() => undefined);
      setMessage(body.error || "送出失敗");
      setIsSubmitting(false);
      return;
    }

    const receipt = body.receipt as Receipt | undefined;
    const savedAllocations = (body.allocations ?? []) as Allocation[];
    let savedAttachment: ReceiptAttachment | null = null;
    if (receipt?.receipt_id) {
      try {
        const compressedImage = await compressedImagePromise;
        savedAttachment = await uploadReceiptImage(receipt.receipt_id, compressedImage);
      } catch (error) {
        applySavedReceipt(receipt, savedAllocations, null);
        setMessage(error instanceof Error ? error.message : "照片上傳失敗");
        setIsSubmitting(false);
        return;
      }
    } else compressedImagePromise.catch(() => undefined);
    if (receipt) {
      applySavedReceipt(receipt, savedAllocations, savedAttachment);
      setPage(0);
    }
    setMessage("");
    setForm((current) => ({ ...current, merchant: "", receipt_no: "", total_amount: "", note: "", category: "餐費補助" }));
    setImageFile(null);
    setIsMultiClaim(false);
    setClaimInputs([{ employee_id: employee.employee_id, amount: "" }]);
    setUploadModalOpen(false);
    setIsSubmitting(false);
  }

  function applySavedReceipt(receipt: Receipt, savedAllocations: Allocation[], savedAttachment: ReceiptAttachment | null) {
    setReceipts((current) => {
      const nextReceipts = sortReceipts([receipt, ...current.filter((item) => item.receipt_id !== receipt.receipt_id)]);
      setAllocations((currentAllocations) => {
        const nextAllocations = [...currentAllocations.filter((allocation) => allocation.receipt_id !== receipt.receipt_id), ...savedAllocations];
        if (employee) setSummary(buildSummary(employee.employee_id, nextReceipts, nextAllocations));
        return nextAllocations;
      });
      return nextReceipts;
    });
    if (savedAttachment) {
      setAttachments((current) => [...current.filter((attachment) => attachment.receipt_id !== savedAttachment.receipt_id), savedAttachment]);
    }
  }

  async function uploadReceiptImage(receiptId: string, compressed: File) {
    if (!employee) return null;
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
    const completeBody = await completeResponse.json();
    return (completeBody.attachment ?? null) as ReceiptAttachment | null;
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
    if (passwordForm.next_password !== passwordForm.confirm_password) {
      setMessage("兩次密碼輸入不一致");
      return;
    }
    const response = await fetch("/api/employee/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next_password: passwordForm.next_password })
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "密碼更新失敗");
      return;
    }
    setPasswordForm({ next_password: "", confirm_password: "" });
    setMessage("");
    setPasswordModalOpen(false);
  }

  function getDayOfWeek(dateString: string) {
    if (!dateString) return "";
    const [y, m, d] = dateString.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    return ["日", "一", "二", "三", "四", "五", "六"][dateObj.getDay()];
  }

  return (
    <main className="mobile-shell" onClick={() => setIsMenuOpen(false)}>
      <section className="mobile-screen" style={{ paddingBottom: "24px" }} onClick={(e) => e.stopPropagation()}>
        <header className="mobile-header" style={{ position: "relative", marginBottom: "24px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "20px" }}>{employee?.name ? `${employee.name} - ` : ""}單據列表</h1>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button 
              className="ghost-btn compact"
              onClick={openUploadModal}
              style={{ borderRadius: "8px" }}
            >
              <Camera size={15} />
              上傳單據
            </button>
            <div style={{ position: "relative" }}>
              <button className="icon-btn" style={{ borderRadius: "8px" }} onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }}>
                <Menu size={16} />
              </button>
              {isMenuOpen && (
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "8px",
                  display: "grid",
                  gap: "4px",
                  minWidth: "150px",
                  zIndex: 50,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
                }}>
                  <button className="nav-btn" onClick={() => { setPasswordModalOpen(true); setMessage(""); setIsMenuOpen(false); }} style={{ borderRadius: "6px" }}>
                    <KeyRound size={16} /> 更改密碼
                  </button>
                  <button className="nav-btn" onClick={handleLogout} style={{ borderRadius: "6px" }}>
                    <LogOut size={16} /> 登出
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="mobile-summary" style={{ display: "block", padding: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", color: "var(--soft)" }}>待請款單據</span>
              <strong style={{ fontSize: "18px", margin: 0 }}>{summary.pendingCount} 筆</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", color: "var(--soft)" }}>單據總金額</span>
              <strong style={{ fontSize: "18px", margin: 0 }}>{money(summary.pendingTotalAmount)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", color: "var(--soft)" }}>可請款總金額</span>
              <strong style={{ fontSize: "22px", color: "var(--primary)", margin: 0 }}>{money(summary.pendingClaimableAmount)}</strong>
            </div>
          </div>
        </section>

        <section className="password-panel" style={{ marginTop: 0 }}>
          <div className="mini-list">
            {receipts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((receipt) => {
              const claimNames = receipt.claimant_names?.length ? receipt.claimant_names.join("、") : employee?.name ?? "-";
              const attachment = receiptAttachments.get(receipt.receipt_id);
              const merchant = receipt.merchant || "未填寫店家";
              const status = receipt.reimbursement_status;
              const isRejected = status === "rejected";
              const isPending = status === "pending";
              const canDelete = isPending || isRejected;
              return (
                <div className="mini-list-item" key={receipt.receipt_id} style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "stretch", position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
                      {receipt.date} (星期{getDayOfWeek(receipt.date)})
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--soft)", background: "var(--bg)", padding: "2px 7px", borderRadius: "4px", border: "1px solid var(--border)", fontWeight: 500 }}>
                        {receipt.category || "餐費補助"}
                      </span>
                      <span 
                        style={{ 
                          color: isRejected ? "#ef4444" : isPending ? "var(--accent)" : "var(--soft)", 
                          fontSize: "12px", 
                          fontWeight: 600, 
                          padding: "2px 8px", 
                          borderRadius: "4px", 
                          background: isRejected ? "rgba(239, 68, 68, 0.1)" : "var(--bg)",
                          border: isRejected ? "1px solid rgba(239, 68, 68, 0.2)" : "none"
                        }}
                      >
                        {statusLabel(receipt.reimbursement_status)}
                      </span>
                      {canDelete && (
                        <button 
                          className="icon-btn" 
                          style={{ color: "#ef4444", padding: "4px", margin: "-4px" }}
                          onClick={() => handleDeleteReceipt(receipt.receipt_id)}
                          title={isRejected ? "刪除退單" : "刪除抽單"}
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: "16px", color: "var(--text)" }}>{merchant}</strong>
                    <span style={{ fontWeight: 600, color: "var(--text)", fontSize: "15px" }}>{money(receipt.total_amount)}</span>
                  </div>
                  
                  {receipt.claimant_names && receipt.claimant_names.length > 1 && (
                    <div style={{ fontSize: "13px", color: "var(--soft)" }}>合單人：{claimNames}</div>
                  )}
                  
                  <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    {attachment ? (
                      <button 
                        className="ghost-btn compact" 
                        style={{ flex: 1, borderRadius: "6px" }}
                        onClick={(e) => { e.preventDefault(); openAttachment(attachment); }}
                      >
                        查看收據
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {!receipts.length ? <p className="form-message">尚未送出單據</p> : null}
            {(receipts.length > PAGE_SIZE || hasMoreReceipts) && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", padding: "16px 0 4px" }}>
                <button
                  className="ghost-btn compact"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  上一頁
                </button>
                <span style={{ fontSize: "13px", color: "var(--soft)" }}>
                  {page + 1} / {hasMoreReceipts ? "..." : Math.ceil(receipts.length / PAGE_SIZE)}
                </span>
                <button
                  className="ghost-btn compact"
                  disabled={isLoadingReceipts || ((page + 1) * PAGE_SIZE >= receipts.length && !hasMoreReceipts)}
                  onClick={goToNextPage}
                >
                  {isLoadingReceipts ? "載入中..." : "下一頁"}
                </button>
              </div>
            )}
          </div>
        </section>

      </section>

      {uploadModalOpen ? (
        <div className="modal-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) setUploadModalOpen(false); }}>
          <div className="modal-card" role="dialog" aria-modal="true" style={{ maxHeight: "90vh", overflowY: "auto" }}>
            <div className="modal-header">
              <div className="panel-title inline-title">
                <Camera size={17} />
                <h2>上傳單據</h2>
              </div>
              <button type="button" className="icon-btn" title="關閉" onClick={() => setUploadModalOpen(false)}>
                <X size={15} />
              </button>
            </div>
            
            <form className="mobile-form" style={{ padding: 0 }} onSubmit={submitReceipt}>
              <label>
                項目
                <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                  <option value="餐費補助">餐費補助</option>
                  <option value="物品請購">物品請購</option>
                </select>
              </label>
              <label>
                單據日期 (星期{getDayOfWeek(form.date)})
                <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required />
              </label>
              <label>
                店家 (選填)
                <input placeholder="例如：福勝亭" value={form.merchant} onChange={(event) => setForm({ ...form, merchant: event.target.value })} />
              </label>
              <label>
                發票號碼 (選填)
                <input placeholder="AB-12345678" value={form.receipt_no} onChange={(event) => setForm({ ...form, receipt_no: event.target.value })} />
              </label>
              <label>
                單據總金額 (必填)
                <input type="number" min="1" value={form.total_amount} onChange={(event) => setForm({ ...form, total_amount: event.target.value })} required />
              </label>
              <label>
                備註 (選填)
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

              <div className="mobile-section-title" style={{ marginTop: "12px", marginBottom: "4px" }}>
                <UsersRound size={16} />
                <label className="check-row" style={{ color: "var(--soft)", fontSize: "14px", margin: 0, fontWeight: 500, cursor: "pointer" }}>
                  <input type="checkbox" checked={isMultiClaim} onChange={(e) => setIsMultiClaim(e.target.checked)} />
                  多人合單
                </label>
              </div>

              {isMultiClaim && (
                <div className="claim-card">
                  {departments.map((dept) => {
                    const deptClaimants = activeClaimants.filter(c => c.department_id === dept.id);
                    if (deptClaimants.length === 0) return null;
                    return (
                      <div key={dept.id} style={{ marginBottom: "16px" }}>
                        <div className="eyebrow" style={{ marginBottom: "8px", color: "var(--primary)" }}>{dept.name}</div>
                        {deptClaimants.map((claimant) => (
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
                      </div>
                    );
                  })}
                  <p>每人每日最多兩張單據，合併補助上限 {money(DAILY_SUBSIDY_LIMIT)}。</p>
                </div>
              )}

              {message ? <p className="form-message">{message}</p> : null}

              <div className="form-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="ghost-btn" onClick={() => setUploadModalOpen(false)}>
                  取消
                </button>
                <button className="primary-btn" type="submit" disabled={isSubmitting}>
                  <ReceiptText size={17} />
                  {isSubmitting ? "送出中..." : "送出單據"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {passwordModalOpen ? (
        <div className="modal-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) setPasswordModalOpen(false); }}>
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div className="panel-title inline-title">
                <KeyRound size={17} />
                <h2>更改登入密碼</h2>
              </div>
              <button type="button" className="icon-btn" title="關閉" onClick={() => setPasswordModalOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <form className="form-grid single" onSubmit={changePassword}>
              {message ? <p className="form-message">{message}</p> : null}
              <label>
                新密碼
                <input type="password" minLength={8} value={passwordForm.next_password} onChange={(event) => setPasswordForm({ ...passwordForm, next_password: event.target.value })} required />
              </label>
              <label>
                確認新密碼
                <input type="password" minLength={8} value={passwordForm.confirm_password} onChange={(event) => setPasswordForm({ ...passwordForm, confirm_password: event.target.value })} required />
              </label>
              <div className="form-actions" style={{ marginTop: "16px" }}>
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

    </main>
  );
}

function sortReceipts(items: Receipt[]) {
  return [...items].sort((a, b) => {
    const aRejected = a.reimbursement_status === "rejected";
    const bRejected = b.reimbursement_status === "rejected";
    if (aRejected && !bRejected) return -1;
    if (!aRejected && bRejected) return 1;
    return `${b.date}|${b.created_at}`.localeCompare(`${a.date}|${a.created_at}`);
  });
}

function buildSummary(employeeId: string, receipts: Receipt[], allocations: Allocation[]): Summary {
  const ownAllocations = allocations.filter((allocation) => allocation.employee_id === employeeId);
  const paidReceiptIds = new Set(receipts.filter((receipt) => receipt.reimbursement_status === "paid").map((receipt) => receipt.receipt_id));
  const pendingReceipts = receipts.filter((receipt) => receipt.reimbursement_status !== "paid" && receipt.reimbursement_status !== "rejected");
  const pendingReceiptIds = new Set(pendingReceipts.map((receipt) => receipt.receipt_id));
  const allPendingClaims = ownAllocations
    .filter((allocation) => pendingReceiptIds.has(allocation.receipt_id))
    .map((allocation) => ({
      id: allocation.allocation_id,
      profileId: allocation.employee_id,
      claimDate: allocation.date,
      claimedAmount: allocation.amount,
      createdAt: allocation.created_at
    }));
  const calculatedPendingSubsidies = calculateDailyClaimSubsidies(allPendingClaims);
  const submittedTotal = receipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0);
  const paidTotal = ownAllocations
    .filter((allocation) => paidReceiptIds.has(allocation.receipt_id))
    .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);

  return {
    submittedTotal,
    paidTotal,
    unpaidTotal: Math.max(0, submittedTotal - paidTotal),
    pendingCount: pendingReceipts.length,
    pendingTotalAmount: pendingReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0),
    pendingClaimableAmount: calculatedPendingSubsidies.reduce((sum, subsidy) => sum + subsidy.subsidyAmount, 0)
  };
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
