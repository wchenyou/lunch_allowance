"use client";

import { Building2, Edit3, KeyRound, LogOut, Plus, ShieldCheck, Trash2, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { visibleDepartments } from "@/app/lib/departments";
import type { AppRole, Department, Profile } from "@/app/lib/domain";

type ScopeRow = { admin_profile_id: string; department_id?: string; employee_profile_id?: string };
type DepartmentForm = { id: string; code: string; name: string; active: boolean };
type AccountForm = {
  id: string;
  employee_no: string;
  display_name: string;
  email: string;
  phone: string;
  department_id: string;
  app_role: AppRole;
  active: boolean;
  password: string;
  department_ids: string[];
};

const emptyDepartmentForm: DepartmentForm = { id: "", code: "", name: "", active: true };
const emptyAccountForm: AccountForm = {
  id: "",
  employee_no: "",
  display_name: "",
  email: "",
  phone: "",
  department_id: "",
  app_role: "employee",
  active: true,
  password: "",
  department_ids: []
};

const roleLabels: Record<AppRole, string> = {
  super_admin: "最高權限",
  department_admin: "部門行政",
  employee: "員工"
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departmentScopes, setDepartmentScopes] = useState<ScopeRow[]>([]);
  const [message, setMessage] = useState("");
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm>(emptyDepartmentForm);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm);
  const [departmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingDepartment, setSavingDepartment] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ next_password: "", confirm_password: "" });
  const [session, setSession] = useState<any>(null);

  const selectableDepartments = useMemo(() => visibleDepartments(departments).filter((department) => department.active), [departments]);
  const listedDepartments = useMemo(() => visibleDepartments(departments), [departments]);
  const profilesByRole = useMemo(
    () => ({
      super_admin: profiles.filter((profile) => normalizedRole(profile) === "super_admin"),
      department_admin: profiles.filter((profile) => normalizedRole(profile) === "department_admin"),
      employee: profiles.filter((profile) => normalizedRole(profile) === "employee")
    }),
    [profiles]
  );

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const [departmentResponse, accountResponse, scopeResponse, sessionResponse] = await Promise.all([
        fetch("/api/super-admin/departments", { cache: "no-store" }),
        fetch("/api/super-admin/accounts", { cache: "no-store" }),
        fetch("/api/super-admin/admin-scopes", { cache: "no-store" }),
        fetch("/api/auth/session")
      ]);
      const [departmentBody, accountBody, scopeBody, sessionBody] = await Promise.all([
        readJson(departmentResponse),
        readJson(accountResponse),
        readJson(scopeResponse),
        readJson(sessionResponse)
      ]);
      if (!departmentResponse.ok) throw new Error(departmentBody.error || "部門資料載入失敗");
      if (!accountResponse.ok) throw new Error(accountBody.error || "帳號資料載入失敗");
      if (!scopeResponse.ok) throw new Error(scopeBody.error || "管理範圍載入失敗");
      setDepartments(departmentBody.departments ?? []);
      setProfiles(accountBody.profiles ?? []);
      setDepartmentScopes(scopeBody.departmentScopes ?? []);
      if (sessionBody.authenticated) {
        setSession(sessionBody.session);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "資料載入失敗");
    }
  }

  async function saveDepartment(event: FormEvent) {
    event.preventDefault();
    setSavingDepartment(true);
    try {
      const response = await fetch("/api/super-admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(departmentForm)
      });
      const body = await readJson(response);
      setMessage(response.ok ? "部門已儲存" : body.error || "部門儲存失敗");
      if (response.ok) {
        closeDepartmentModal();
        await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "部門儲存失敗");
    } finally {
      setSavingDepartment(false);
    }
  }

  async function deleteDepartment(id: string) {
    if (!confirm("確定要刪除此部門嗎？若有關聯資料將無法刪除。")) return;
    const response = await fetch("/api/super-admin/departments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const body = await response.json();
    setMessage(response.ok ? "部門已刪除" : body.error || "部門刪除失敗");
    if (response.ok) await refresh();
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    setSavingAccount(true);
    try {
      const payload = accountForm.app_role === "department_admin" ? accountForm : { ...accountForm, department_ids: [] };
      const response = await fetch("/api/super-admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await readJson(response);
      setMessage(response.ok ? "帳號已儲存" : body.error || "帳號儲存失敗");
      if (response.ok) {
        await refresh();
        closeAccountModal();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "帳號儲存失敗");
    } finally {
      setSavingAccount(false);
    }
  }

  async function deleteAccount(id: string) {
    if (!confirm("確定要刪除此帳號嗎？若有關聯收據紀錄將無法刪除。")) return;
    const response = await fetch("/api/super-admin/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const body = await response.json();
    setMessage(response.ok ? "帳號已刪除" : body.error || "帳號刪除失敗");
    if (response.ok) await refresh();
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
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
    setPasswordModalOpen(false);
    setMessage("密碼已更新");
  }

  function openNewDepartment() {
    setDepartmentForm(emptyDepartmentForm);
    setDepartmentModalOpen(true);
  }

  function editDepartment(department: Department) {
    setDepartmentForm({
      id: department.id,
      code: department.code,
      name: department.name,
      active: department.active
    });
    setDepartmentModalOpen(true);
  }

  function closeDepartmentModal() {
    setDepartmentForm(emptyDepartmentForm);
    setDepartmentModalOpen(false);
  }

  function openNewAccount() {
    setAccountForm(emptyAccountForm);
    setAccountModalOpen(true);
  }

  function editAccount(profile: Profile) {
    setAccountForm({
      id: profile.id,
      employee_no: profile.employee_no ?? "",
      display_name: profile.display_name,
      email: profile.email ?? "",
      phone: profile.phone ?? "",
      department_id: profile.department_id ?? "",
      app_role: profile.app_role ?? "employee",
      active: profile.active,
      password: "",
      department_ids: scopesFor(profile.id)
    });
    setAccountModalOpen(true);
  }

  function closeAccountModal() {
    setAccountForm(emptyAccountForm);
    setAccountModalOpen(false);
  }

  function toggleManagedDepartment(departmentId: string, checked: boolean) {
    setAccountForm((current) => {
      const nextDepartmentIds = checked
        ? [...new Set([...current.department_ids, departmentId])]
        : current.department_ids.filter((id) => id !== departmentId);
      return { ...current, department_ids: nextDepartmentIds };
    });
  }

  function scopesFor(adminProfileId: string) {
    return departmentScopes
      .filter((scope) => scope.admin_profile_id === adminProfileId && scope.department_id)
      .map((scope) => scope.department_id as string);
  }

  function departmentName(id: string | null | undefined) {
    if (!id) return "-";
    return departments.find((department) => department.id === id)?.name ?? id;
  }

  function roleName(role: Profile["role"] | AppRole | null | undefined) {
    if (role === "admin" || role === "super_admin") return roleLabels.super_admin;
    if (role === "hr" || role === "manager" || role === "department_admin") return roleLabels.department_admin;
    return roleLabels.employee;
  }

  function normalizedRole(profile: Profile): AppRole {
    const role = profile.app_role ?? profile.role;
    if (role === "admin" || role === "super_admin") return "super_admin";
    if (role === "hr" || role === "manager" || role === "department_admin") return "department_admin";
    return "employee";
  }

  function managedDepartmentNames(profile: Profile) {
    const scopeIds = scopesFor(profile.id);
    return scopeIds.length ? scopeIds.map(departmentName).join(", ") : "尚未設定";
  }

  function renderProfileRows(role: AppRole) {
    return profilesByRole[role].map((profile) => (
      <tr key={profile.id}>
        <td>{profile.display_name}</td>
        <td>{roleName(profile.app_role ?? profile.role)}</td>
        <td>{departmentName(profile.department_id)}</td>
        {role === "department_admin" ? <td className="wrap-cell">{managedDepartmentNames(profile)}</td> : null}
        <td>{profile.active && !profile.login_disabled_at ? "啟用" : "停用"}</td>
        <td>
          <div className="row-actions">
            <button className="icon-btn" title="編輯" onClick={() => editAccount(profile)}>
              <Edit3 size={14} />
            </button>
            <button className="icon-btn" title="停用" onClick={() => deleteAccount(profile.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
    ));
  }

  function renderRoleSection(role: AppRole) {
    const rows = profilesByRole[role];
    return (
      <div className={`role-section role-section-${role}`} key={role}>
        <div className="role-section-header">
          <div>
            <h3>{roleLabels[role]}</h3>
            <p>{roleDescription(role)}</p>
          </div>
          <span className="role-count">{rows.length} 人</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>角色</th>
                <th>所屬部門</th>
                {role === "department_admin" ? <th>可管理部門</th> : null}
                <th>狀態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{renderProfileRows(role)}</tbody>
          </table>
          {!rows.length ? <div className="empty compact">尚未建立{roleLabels[role]}帳號</div> : null}
        </div>
      </div>
    );
  }

  function roleDescription(role: AppRole) {
    if (role === "super_admin") return "可管理部門、帳號與全域權限";
    if (role === "department_admin") return "依照勾選部門管理員工與單據";
    return "手機端送出單據與查看流程狀態";
  }

  return (
    <div className="app-shell admin-skeleton">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">權</div>
          <div>
            <strong>最高管理後台</strong>
            <span>{session ? (session.displayName + (session.account && session.account !== session.displayName ? ` (${session.account})` : "")) : "載入中..."}</span>
          </div>
        </div>
        <nav>
          <a className="nav-btn active" href="/super-admin">
            <ShieldCheck size={16} />
            權限總覽
          </a>
        </nav>
        <div style={{ marginTop: "auto", display: "grid", gap: "4px" }}>
          <button className="nav-btn" onClick={() => setPasswordModalOpen(true)}>
            <KeyRound size={16} />
            更改密碼
          </button>
          <button className="nav-btn" onClick={handleLogout}>
            <LogOut size={16} />
            登出
          </button>
        </div>
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
            <strong>{listedDepartments.length}</strong>
          </div>
          <div className="metric">
            <span>人員</span>
            <strong>{profiles.length}</strong>
          </div>
          <div className="metric">
            <span>管理部門授權</span>
            <strong>{departmentScopes.length}</strong>
          </div>
        </section>

        <section className="stack">
            <div className="panel">
              <div className="section-row panel-title">
                <div className="panel-title inline-title">
                  <Building2 size={17} />
                  <h2>部門列表</h2>
                </div>
                <button type="button" className="primary-btn" onClick={openNewDepartment}>
                  <Plus size={15} />
                  新增部門
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>代碼</th>
                      <th>名稱</th>
                      <th>狀態</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {listedDepartments.map((department) => (
                      <tr key={department.id}>
                        <td>{department.code}</td>
                        <td>{department.name}</td>
                        <td>{department.active ? "啟用" : "停用"}</td>
                        <td>
                          <div className="row-actions">
                            <button className="icon-btn" title="編輯" onClick={() => editDepartment(department)}>
                              <Edit3 size={14} />
                            </button>
                            <button className="icon-btn" title="停用" onClick={() => deleteDepartment(department.id)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!listedDepartments.length ? <div className="empty">尚未建立部門</div> : null}
              </div>
            </div>

            <div className="panel">
              <div className="section-row panel-title">
                <div className="panel-title inline-title">
                  <UsersRound size={17} />
                  <h2>帳號 / 人員列表</h2>
                </div>
                <button type="button" className="primary-btn" onClick={openNewAccount}>
                  <Plus size={15} />
                  新增帳號
                </button>
              </div>
              <div className="role-sections">
                {renderRoleSection("super_admin")}
                {renderRoleSection("department_admin")}
                {renderRoleSection("employee")}
              </div>
            </div>
        </section>
      </main>
      {departmentModalOpen ? (
        <div className="modal-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) closeDepartmentModal(); }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="department-modal-title">
            <div className="modal-header">
              <div className="panel-title inline-title">
                <Building2 size={17} />
                <h2 id="department-modal-title">{departmentForm.id ? "編輯部門" : "新增部門"}</h2>
              </div>
              <button type="button" className="icon-btn" title="關閉" onClick={closeDepartmentModal}>
                <X size={15} />
              </button>
            </div>
            <form className="form-grid single" onSubmit={saveDepartment}>
              <label>
                部門代碼
                <input value={departmentForm.code} onChange={(event) => setDepartmentForm({ ...departmentForm, code: event.target.value })} required />
              </label>
              <label>
                部門名稱
                <input value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} required />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={departmentForm.active} onChange={(event) => setDepartmentForm({ ...departmentForm, active: event.target.checked })} />
                啟用
              </label>
              <div className="form-actions">
                <button type="button" className="ghost-btn" onClick={closeDepartmentModal}>
                  取消
                </button>
                <button className="primary-btn" disabled={savingDepartment}>{savingDepartment ? "儲存中..." : "儲存部門"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {accountModalOpen ? (
        <div className="modal-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) closeAccountModal(); }}>
          <div className="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
            <div className="modal-header">
              <div className="panel-title inline-title">
                <KeyRound size={17} />
                <h2 id="account-modal-title">{accountForm.id ? "編輯帳號" : "新增人員 / 行政帳號"}</h2>
              </div>
              <button type="button" className="icon-btn" title="關閉" onClick={closeAccountModal}>
                <X size={15} />
              </button>
            </div>
            <form className="form-grid" onSubmit={saveAccount}>
              <label>
                姓名
                <input value={accountForm.display_name} onChange={(event) => setAccountForm({ ...accountForm, display_name: event.target.value })} required />
              </label>
              <label>
                員工編號
                <input value={accountForm.employee_no} onChange={(event) => setAccountForm({ ...accountForm, employee_no: event.target.value })} />
              </label>
              <label>
                Email
                <input type="email" value={accountForm.email} onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })} />
              </label>
              <label>
                電話
                <input value={accountForm.phone} onChange={(event) => setAccountForm({ ...accountForm, phone: event.target.value })} />
              </label>
              <label>
                角色
                <select
                  value={accountForm.app_role}
                  onChange={(event) => {
                    const nextRole = event.target.value as AppRole;
                    setAccountForm({ ...accountForm, app_role: nextRole, department_ids: nextRole === "department_admin" ? accountForm.department_ids : [] });
                  }}
                >
                  <option value="employee">員工</option>
                  <option value="department_admin">部門行政</option>
                  <option value="super_admin">最高權限</option>
                </select>
              </label>
              <label>
                所屬部門
                <select value={accountForm.department_id} onChange={(event) => setAccountForm({ ...accountForm, department_id: event.target.value })}>
                  <option value="">無</option>
                  {selectableDepartments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              {accountForm.app_role === "department_admin" ? (
                <fieldset className="checkbox-fieldset">
                  <legend>可管理部門</legend>
                  <div className="checkbox-grid">
                    {selectableDepartments.map((department) => (
                      <label className="check-tile" key={department.id}>
                        <input
                          type="checkbox"
                          checked={accountForm.department_ids.includes(department.id)}
                          onChange={(event) => toggleManagedDepartment(department.id, event.target.checked)}
                        />
                        <span>{department.name}</span>
                      </label>
                    ))}
                    {!selectableDepartments.length ? <div className="empty compact">尚無可設定的啟用部門</div> : null}
                  </div>
                </fieldset>
              ) : null}
              <label>
                {accountForm.id ? "新密碼（留空不變）" : "初始密碼"}
                <input type="password" value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={accountForm.active} onChange={(event) => setAccountForm({ ...accountForm, active: event.target.checked })} />
                啟用
              </label>
              <div className="form-actions">
                <button type="button" className="ghost-btn" onClick={closeAccountModal}>
                  取消
                </button>
                <button className="primary-btn" type="submit" disabled={savingAccount}>{savingAccount ? "儲存中..." : "儲存帳號"}</button>
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
              <button className="icon-btn" title="關閉" onClick={() => setPasswordModalOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <form className="form-grid single" onSubmit={changePassword}>
              <label>
                新密碼
                <input type="password" minLength={8} value={passwordForm.next_password} onChange={(event) => setPasswordForm({ ...passwordForm, next_password: event.target.value })} required />
              </label>
              <label>
                確認新密碼
                <input type="password" minLength={8} value={passwordForm.confirm_password} onChange={(event) => setPasswordForm({ ...passwordForm, confirm_password: event.target.value })} required />
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

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
