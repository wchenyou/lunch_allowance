"use client";

import { Building2, ClipboardList, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Department, Profile, ReceiptRecord } from "@/app/lib/domain";

const money = (value: number) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);

type AdminScope = {
  departments: Department[];
  profiles: Profile[];
  receipts: ReceiptRecord[];
};

export default function DepartmentAdminPage() {
  const [scope, setScope] = useState<AdminScope>({ departments: [], profiles: [], receipts: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/scope")
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setError(body.error || "無法載入部門行政資料");
          return;
        }
        setScope(body);
      });
  }, []);

  const totals = useMemo(
    () => ({
      submitted: scope.receipts.length,
      amount: scope.receipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0),
      employees: scope.profiles.filter((profile) => profile.active).length
    }),
    [scope]
  );

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
          <a className="nav-btn active" href="/admin">
            <ClipboardList size={16} />
            匯總
          </a>
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Department admin scope</p>
            <h1>部門單據與人員匯總</h1>
          </div>
          {error ? <div className="toast">{error}</div> : null}
        </header>

        <section className="metric-grid">
          <div className="metric">
            <span>可管理部門</span>
            <strong>{scope.departments.length}</strong>
          </div>
          <div className="metric">
            <span>啟用員工</span>
            <strong>{totals.employees}</strong>
          </div>
          <div className="metric">
            <span>單據金額</span>
            <strong>{money(totals.amount)}</strong>
          </div>
        </section>

        <section className="grid two">
          <div className="panel">
            <div className="panel-title">
              <Building2 size={17} />
              <h2>授權部門</h2>
            </div>
            <div className="role-list">
              {scope.departments.map((department) => (
                <div className="role-item" key={department.id}>
                  <strong>{department.code}</strong>
                  <span>{department.name}</span>
                  <span>{department.active ? "啟用" : "停用"}</span>
                </div>
              ))}
              {!scope.departments.length ? <div className="empty">尚未授權任何部門</div> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">
              <UsersRound size={17} />
              <h2>員工 / 單據 scope</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>角色</th>
                    <th>狀態</th>
                    <th>部門</th>
                  </tr>
                </thead>
                <tbody>
                  {scope.profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>{profile.display_name}</td>
                      <td>{profile.app_role ?? profile.role}</td>
                      <td>{profile.active ? "啟用" : "停用"}</td>
                      <td>{profile.department_id ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
