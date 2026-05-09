"use client";

import { FormEvent, useEffect, useState } from "react";
import { Building2, ShieldCheck, UserRound } from "lucide-react";
import type { AppRole } from "@/app/lib/domain";

type LoginDepartment = { id: string; name: string; active: boolean };

export type LoginConfig = {
  intendedRole: AppRole;
  title: string;
  description: string;
  icon: "employee" | "admin" | "super-admin";
  submitLabel: string;
  showDepartmentSelect?: boolean;
};

const iconMap = {
  employee: UserRound,
  admin: Building2,
  "super-admin": ShieldCheck
};

export function LoginForm({ config }: { config: LoginConfig }) {
  const [departments, setDepartments] = useState<LoginDepartment[]>([]);
  const [form, setForm] = useState({ department_id: "", account: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const LoginIcon = iconMap[config.icon];

  useEffect(() => {
    if (!config.showDepartmentSelect) return;

    fetch(`/api/auth/options?role=${config.intendedRole}`)
      .then((response) => response.json())
      .then((data) => {
        const nextDepartments = data.departments ?? [];
        const firstDepartmentId = nextDepartments[0]?.id || "";
        setDepartments(nextDepartments);
        setForm((current) => ({
          ...current,
          department_id: current.department_id || firstDepartmentId
        }));
      })
      .catch(() => setError("無法載入登入選項"));
  }, [config.intendedRole, config.showDepartmentSelect]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: form.account.trim(),
        department_id: config.showDepartmentSelect ? form.department_id : undefined,
        password: form.password,
        intended_role: config.intendedRole
      })
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

        {config.showDepartmentSelect ? (
          <label>
            部門
            <select value={form.department_id} onChange={(event) => setForm({ ...form, department_id: event.target.value })} required>
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
          <input
            value={form.account}
            onChange={(event) => setForm({ ...form, account: event.target.value })}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label>
          密碼
          <input
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <div className="error-text">{error}</div> : null}
        <button className="primary-btn" disabled={loading}>
          {loading ? "登入中..." : config.submitLabel}
        </button>
      </form>
    </main>
  );
}
