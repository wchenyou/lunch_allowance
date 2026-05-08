"use client";

import { FormEvent, useState } from "react";
import { Lock } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    setLoading(false);
    if (!response.ok) {
      setError("管理密碼錯誤");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-icon">
          <Lock size={18} />
        </div>
        <h1>午餐補助後台</h1>
        <p>輸入管理密碼後開始登記收據與結算請款。</p>
        <label>
          管理密碼
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoFocus />
        </label>
        {error ? <div className="error-text">{error}</div> : null}
        <button className="primary-btn" disabled={loading}>
          {loading ? "登入中..." : "登入"}
        </button>
      </form>
    </main>
  );
}
