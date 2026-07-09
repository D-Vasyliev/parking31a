import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import { useAuth } from "../auth";
import { AuthShell } from "../components/AuthShell";
import type { LoginResult } from "../../shared/api";

export function Login() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await apiPost<LoginResult>("/api/auth/login", { email, password });
    setBusy(false);
    if (r.ok && r.data) {
      nav(r.data.next === "enroll" ? "/login/setup-2fa" : "/login/2fa");
    } else {
      setError(r.error?.message ?? "Помилка входу");
    }
  }

  return (
    <AuthShell title="Вхід" subtitle="пр. Правди 31-33 / 31-А">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Вхід…" : "Увійти"}
        </button>
      </form>
    </AuthShell>
  );
}
