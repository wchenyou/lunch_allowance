"use client";

import { Building2, KeyRound, ShieldCheck, UsersRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AppRole, Department, Profile } from "@/app/lib/domain";

type ScopeRow = { admin_profile_id: string; department_id?: string; employee_profile_id?: string };

export default function SuperAdminPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departmentScopes, setDepartmentScopes] = useState<ScopeRow[]>([]);
  const [message, setMessage] = useState("");
  const [departmentForm, setDepartmentForm] = useState({ code: "", name: "" });
  const [accountForm, setAccountForm] = useState({ display_name: "", department_id: "", app_role: "employee" as AppRole, password: "" });

  const departmentAdmins = useMemo(() => profiles.filter((profile) => (profile.app_role ?? profile.role) === "department_admin"), [profiles]);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const [departmentResponse, accountResponse, scopeResponse] = await Promise.all([
      fetch("/api/super-admin/departments"),
      fetch("/api/super-admin/accounts"),
      fetch("/api/super-admin/admin-scopes")
    ]);
    const [departmentBody, accountBody, scopeBody] = await Promise.all([departmentResponse.json(), accountResponse.json(), scopeResponse.json()]);
    setDepartments(departmentBody.departments ?? []);
    setProfiles(accountBody.profiles ?? []);
    setDepartmentScopes(scopeBody.departmentScopes ?? []);
  }

  async function createDepartment(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/super-admin/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(departmentForm)
    });
    const body = await response.json();
    setMessage(response.ok ? "部門已儲存" : body.error || "部門儲存失敗");
    if (response.ok) {
      setDepartmentForm({ code: "", name: "" });
      refresh();
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/super-admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountForm)
    });
    const body = await response.json();
    setMessage(response.ok ? "帳號已儲存" : body.error || "帳號儲存失敗");
    if (response.ok) {
      setAccountForm({ display_name: "", department_id: "", app_role: "employee", password: "" });
      refresh();
    }
  }

  return (
    <div className="app-shell admin-skeleton">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">權</div>
          <div>
            <strong>最高管理後台</strong>
            <span>三層角色與部門 scope</span>
          </div>
        </div>
        <nav>
          <a className="nav-btn active" href="/super-admin">
            <ShieldCheck size={16} />
            權限總覽
          </a>
          <a className="nav-btn" href="/admin">
            <UsersRound size={16} />
            部門行政
          </a>
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Super admin</p>
            <h1>部門、人員與行政管理範圍</h1>
          </div>
          {message ? <div className="toast">{message}</div> : null}
        </header>

        <section className="metric-grid">
          <div className="metric">
            <span>部門</span>
            <strong>{departments.length}</strong>
          </div>
          <div className="metric">
            <span>人員</span>
            <strong>{profiles.length}</strong>
          </div>
          <div className="metric">
            <span>行政部門 scope</span>
            <strong>{departmentScopes.length}</strong>
          </div>
        </section>

        <section className="grid two">
          <div className="stack">
            <div className="panel">
              <div className="panel-title">
                <Building2 size={17} />
                <h2>新增 / 更新部門</h2>
              </div>
              <form className="form-grid single" onSubmit={createDepartment}>
                <label>
                  部門代碼
                  <input value={departmentForm.code} onChange={(event) => setDepartmentForm({ ...departmentForm, code: event.target.value })} required />
                </label>
                <label>
                  部門名稱
                  <input value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} required />
                </label>
                <button className="primary-btn">儲存部門</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-title">
                <KeyRound size={17} />
                <h2>新增人員 / 行政帳號</h2>
              </div>
              <form className="form-grid single" onSubmit={createAccount}>
                <label>
                  姓名
                  <input value={accountForm.display_name} onChange={(event) => setAccountForm({ ...accountForm, display_name: event.target.value })} required />
                </label>
                <label>
                  角色
                  <select value={accountForm.app_role} onChange={(event) => setAccountForm({ ...accountForm, app_role: event.target.value as AppRole })}>
                    <option value="employee">employee</option>
                    <option value="department_admin">department_admin</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </label>
                <label>
                  所屬部門
                  <select value={accountForm.department_id} onChange={(event) => setAccountForm({ ...accountForm, department_id: event.target.value })}>
                    <option value="">無</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  初始密碼
                  <input type="password" value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} />
                </label>
                <button className="primary-btn">儲存帳號</button>
              </form>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">
              <UsersRound size={17} />
              <h2>行政與部門 scope</h2>
            </div>
            <div className="role-list">
              {departmentAdmins.map((admin) => {
                const scopes = departmentScopes.filter((scope) => scope.admin_profile_id === admin.id);
                return (
                  <div className="role-item" key={admin.id}>
                    <strong>{admin.display_name}</strong>
                    <span>{scopes.length ? scopes.map((scope) => departments.find((department) => department.id === scope.department_id)?.name ?? scope.department_id).join(", ") : "尚未設定部門"}</span>
                  </div>
                );
              })}
              {!departmentAdmins.length ? <div className="empty">尚未建立部門行政帳號</div> : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
