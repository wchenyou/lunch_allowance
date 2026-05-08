"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, Lock, UserRound } from "lucide-react";

type LoginDepartment = { id: string; name: string; active: boolean };
type LoginEmployee = { id: string; display_name: string; department_id: string | null; active: boolean; app_role?: string };

export default function LoginPage() {
  const [departments, setDepartments] = useState<LoginDepartment[]>([]);
  const [employees, setEmployees] = useState<LoginEmployee[]>([]);
  const [form, setForm] = useState({ department_id: "", profile_id: "", password: "" });
  const [adminMode, setAdminMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/options")
      .then((response) => response.json())
      .then((data) => {
        const nextDepartments = data.departments ?? [];
        const nextEmployees = data.employees ?? [];
        setDepartments(nextDepartments);
        setEmployees(nextEmployees);
        setForm((current) => ({
          ...current,
          department_id: current.department_id || nextDepartments[0]?.id || "",
          profile_id: current.profile_id || nextEmployees.find((employee: LoginEmployee) => employee.department_id === nextDepartments[0]?.id)?.id || ""
        }));
      });
  }, []);

  const departmentEmployees = useMemo(
    () => employees.filter((employee) => employee.department_id === form.department_id && employee.active),
    [employees, form.department_id]
  );

  function updateDepartment(departmentId: string) {
    const nextEmployee = employees.find((employee) => employee.department_id === departmentId && employee.active);
    setForm({ ...form, department_id: departmentId, profile_id: nextEmployee?.id || "" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminMode ? { password: form.password } : form)
    });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(body.error || "登入失敗");
      return;
    }
    window.location.href = body.redirect_to || "/";
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-icon">
          <Lock size={18} />
        </div>
        <h1>午餐補助系統</h1>
        <p>選擇部門與姓名後輸入密碼；最高管理員可切換系統管理登入。</p>

        <div className="segmented">
          <button type="button" className={!adminMode ? "active" : ""} onClick={() => setAdminMode(false)}>
            <UserRound size={15} />
            員工 / 行政
          </button>
          <button type="button" className={adminMode ? "active" : ""} onClick={() => setAdminMode(true)}>
            <Building2 size={15} />
            系統管理
          </button>
        </div>

        {!adminMode ? (
          <>
            <label>
              部門
              <select value={form.department_id} onChange={(event) => updateDepartment(event.target.value)} required>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              姓名 / 員工
              <select value={form.profile_id} onChange={(event) => setForm({ ...form, profile_id: event.target.value })} required>
                <option value="" disabled>
                  選擇員工
                </option>
                {departmentEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.display_name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <label>
          密碼
          <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" autoFocus required />
        </label>
        {error ? <div className="error-text">{error}</div> : null}
        <button className="primary-btn" disabled={loading}>
          {loading ? "登入中..." : "登入"}
        </button>
      </form>
    </main>
  );
}
