import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import { useAuth } from "../auth";
import { AuthShell } from "../components/AuthShell";
import type { AuthOkResult } from "../../shared/api";

export function TwoFactor() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = useBackup ? { backupCode: code } : { code };
    const r = await apiPost<AuthOkResult>("/api/auth/totp", body);
    setBusy(false);
    if (r.ok) {
      await refresh();
      nav("/", { replace: true });
    } else if (r.error?.code === "totp_locked") {
      nav("/login", { replace: true });
    } else {
      setError(r.error?.message ?? "Невірний код");
    }
  }

  return (
    <AuthShell title="Підтвердження входу" subtitle={useBackup ? "Введіть резервний код" : "Введіть код із застосунку автентифікації"}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>{useBackup ? "Резервний код" : "Код (6 цифр)"}</span>
          <input
            type="text"
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Перевірка…" : "Підтвердити"}
        </button>
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode("");
            setError(null);
          }}
        >
          {useBackup ? "Використати код із застосунку" : "Використати резервний код"}
        </button>
      </form>
    </AuthShell>
  );
}
