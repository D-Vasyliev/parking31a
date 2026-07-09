import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { apiGet, apiPost } from "../api";
import { useAuth } from "../auth";
import { AuthShell } from "../components/AuthShell";
import { PASSWORD_MIN_LENGTH } from "../../shared/api";
import type { EnrollStatus, EnrollTotpStartResult, EnrollConfirmResult, SessionUser } from "../../shared/api";

type Step = "loading" | "password" | "totp" | "backup";

export function Enroll() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");

  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pendingUser, setPendingUser] = useState<SessionUser | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await apiGet<EnrollStatus>("/api/auth/enroll/status");
      if (!r.ok || !r.data) {
        nav("/login", { replace: true });
        return;
      }
      if (r.data.mustChangePassword) setStep("password");
      else await startTotp();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTotp() {
    setError(null);
    const r = await apiPost<EnrollTotpStartResult>("/api/auth/enroll/totp/start");
    if (!r.ok || !r.data) {
      setError(r.error?.message ?? "Помилка");
      return;
    }
    setSecret(r.data.secret);
    try {
      setQr(await QRCode.toDataURL(r.data.otpauthUri, { margin: 1, width: 220 }));
    } catch {
      setQr("");
    }
    setStep("totp");
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (pw1 !== pw2) return setError("Паролі не збігаються");
    if (pw1.length < PASSWORD_MIN_LENGTH) return setError(`Мінімум ${PASSWORD_MIN_LENGTH} символів`);
    setBusy(true);
    setError(null);
    const r = await apiPost("/api/auth/enroll/password", { newPassword: pw1 });
    setBusy(false);
    if (r.ok) await startTotp();
    else setError(r.error?.message ?? "Помилка");
  }

  async function submitTotp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await apiPost<EnrollConfirmResult>("/api/auth/enroll/totp/confirm", { code });
    setBusy(false);
    if (r.ok && r.data) {
      setBackupCodes(r.data.backupCodes);
      setPendingUser(r.data.user);
      setStep("backup");
    } else {
      setError(r.error?.message ?? "Невірний код");
    }
  }

  function copyCodes() {
    void navigator.clipboard?.writeText(backupCodes.join("\n"));
  }
  function downloadCodes() {
    const blob = new Blob([backupCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parking31a-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  function finish() {
    if (pendingUser) setUser(pendingUser);
    nav("/", { replace: true });
  }

  if (step === "loading") {
    return (
      <AuthShell title="Налаштування">
        <p className="sub">Завантаження…</p>
      </AuthShell>
    );
  }

  if (step === "password") {
    return (
      <AuthShell title="Зміна пароля" subtitle="Задайте постійний пароль (перший вхід)">
        <form className="form" onSubmit={submitPassword}>
          <label className="field">
            <span>Новий пароль</span>
            <input type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>Повторіть пароль</span>
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Збереження…" : "Далі"}
          </button>
        </form>
      </AuthShell>
    );
  }

  if (step === "totp") {
    return (
      <AuthShell title="Двофакторна автентифікація" subtitle="Відскануйте QR у Google Authenticator / Authy та введіть код">
        <div className="enroll-qr">
          {qr ? <img src={qr} alt="QR-код для 2ФА" width={220} height={220} /> : null}
          <p className="secret-hint">
            Не можете сканувати? Введіть код вручну:
            <code className="secret">{secret}</code>
          </p>
        </div>
        <form className="form" onSubmit={submitTotp}>
          <label className="field">
            <span>Код підтвердження</span>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Перевірка…" : "Підтвердити"}
          </button>
        </form>
      </AuthShell>
    );
  }

  // backup
  return (
    <AuthShell title="Резервні коди" subtitle="Збережіть їх у надійному місці. Кожен код одноразовий.">
      <ul className="backup-grid">
        {backupCodes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row-actions">
        <button type="button" className="btn" onClick={copyCodes}>
          Копіювати
        </button>
        <button type="button" className="btn" onClick={downloadCodes}>
          Завантажити .txt
        </button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>Я зберіг резервні коди</span>
      </label>
      <button className="btn btn-primary" type="button" disabled={!saved} onClick={finish}>
        Завершити
      </button>
    </AuthShell>
  );
}
