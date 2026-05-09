"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, ShieldCheck, UserRound } from "lucide-react";
import type { AppRole } from "@/app/lib/domain";

type LoginDepartment = { id: string; name: string; active: boolean };
type LoginEmployee = { id: string; display_name: string; department_id: string | null; active: boolean; app_role?: AppRole };

export type LoginConfig = {
  intendedRole: AppRole;
  title: string;
  description: string;
  icon: "employee" | "admin" | "super-admin";
  submitLabel: string;
  allowPasswordOnly?: boolean;
};

const iconMap = {
  employee: UserRound,
  admin: Building2,
  "super-admin": ShieldCheck
};

export function LoginForm({ config }: { config: LoginConfig }) {
  const [departments, setDepartments] = useState<LoginDepartment[]>([]);
  const [employees, setEmployees] = useState<LoginEmployee[]>([]);
  const [form, setForm] = useState({ department_id: "", profile_id: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const LoginIcon = iconMap[config.icon];

  useEffect(() => {
    fetch(`/api/auth/options?role=${config.intendedRole}`)
      .then((response) => response.json())
      .then((data) => {
        const nextDepartments = data.departments ?? [];
        const nextEmployees = data.employees ?? [];
        const firstDepartmentId = nextDepartments[0]?.id || "";
        const firstEmployee = firstDepartmentId
          ? nextEmployees.find((employee: LoginEmployee) => employee.department_id === firstDepartmentId)
          : nextEmployees[0];
        setDepartments(nextDepartments);
        setEmployees(nextEmployees);
        setForm((current) => ({
          ...current,
          department_id: current.department_id || firstDepartmentId,
          profile_id: current.profile_id || firstEmployee?.id || ""
        }));
      })
      .catch(() => setError("無法載入登入選項"));
  }, [config.intendedRole]);

  const departmentEmployees = useMemo(() => {
    if (!departments.length) return employees.filter((employee) => employee.active);
    return employees.filter((employee) => employee.department_id === form.department_id && employee.active);
  }, [departments.length, employees, form.department_id]);

  const showProfileFields = !config.allowPasswordOnly || employees.length > 0;
  const canSubmitPasswordOnly = config.allowPasswordOnly && !form.profile_id;

  function updateDepartment(departmentId: string) {
    const nextEmployee = employees.find((employee) => employee.department_id === departmentId && employee.active);
    setForm({ ...form, department_id: departmentId, profile_id: nextEmployee?.id || "" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const payload = canSubmitPasswordOnly
      ? { password: form.password, intended_role: config.intendedRole }
      : { ...form, intended_role: config.intendedRole };
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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
          <LoginIcon size={18} />
        </div>
        <h1>{config.title}</h1>
        <p>{config.description}</p>

        {showProfileFields ? (
          <>
            {departments.length ? (
              <label>
                部門
                <select value={form.department_id} onChange={(event) => updateDepartment(event.target.value)} required={!config.allowPasswordOnly}>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              帳號
              <select
                value={form.profile_id}
                onChange={(event) => setForm({ ...form, profile_id: event.target.value })}
                required={!config.allowPasswordOnly}
              >
                <option value="">{config.allowPasswordOnly ? "使用系統管理密碼" : "選擇帳號"}</option>
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
          {loading ? "登入中..." : config.submitLabel}
        </button>
      </form>
    </main>
  );
}
