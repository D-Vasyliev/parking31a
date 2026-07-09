import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { apiGet, apiPost } from "../api";
import { formatDate } from "../format";
import { PASSWORD_MIN_LENGTH } from "../../shared/api";
import type { SessionInfo, EnrollTotpStartResult, EnrollConfirmResult } from "../../shared/api";

function CodesBox({ codes }: { codes: string[] }) {
  return (
    <div>
      <p className="sub">Збережіть резервні коди — кожен одноразовий:</p>
      <ul className="backup-grid">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

export function SecuritySettings() {
  const [cp, setCp] = useState({ cur: "", n1: "", n2: "" });
  const [cpMsg, setCpMsg] = useState<string | null>(null);
  const [reSecret, setReSecret] = useState("");
  const [reQr, setReQr] = useState("");
  const [reCode, setReCode] = useState("");
  const [rePw, setRePw] = useState("");
  const [reCodes, setReCodes] = useState<string[] | null>(null);
  const [reMsg, setReMsg] = useState<string | null>(null);
  const [bcPw, setBcPw] = useState("");
  const [bcCodes, setBcCodes] = useState<string[] | null>(null);
  const [bcMsg, setBcMsg] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadSessions() {
    const r = await apiGet<SessionInfo[]>("/api/auth/sessions");
    if (r.ok && r.data) setSessions(r.data);
  }
  useEffect(() => {
    void loadSessions();
  }, []);

  async function changePw(e: FormEvent) {
    e.preventDefault();
    setCpMsg(null);
    if (cp.n1 !== cp.n2) return setCpMsg("Паролі не збігаються");
    if (cp.n1.length < PASSWORD_MIN_LENGTH) return setCpMsg(`Мінімум ${PASSWORD_MIN_LENGTH} символів`);
    setBusy(true);
    const r = await apiPost("/api/auth/change-password", { currentPassword: cp.cur, newPassword: cp.n1 });
    setBusy(false);
    if (r.ok) {
      setCp({ cur: "", n1: "", n2: "" });
      setCpMsg("Пароль змінено (інші сесії завершено)");
      void loadSessions();
    } else setCpMsg(r.error?.message ?? "Помилка");
  }

  async function start2fa() {
    setReMsg(null);
    setReCodes(null);
    const r = await apiPost<EnrollTotpStartResult>("/api/auth/2fa/start");
    if (r.ok && r.data) {
      setReSecret(r.data.secret);
      try {
        setReQr(await QRCode.toDataURL(r.data.otpauthUri, { margin: 1, width: 200 }));
      } catch {
        setReQr("");
      }
    }
  }
  async function confirm2fa(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setReMsg(null);
    const r = await apiPost<EnrollConfirmResult>("/api/auth/2fa/confirm", { password: rePw, code: reCode, secret: reSecret });
    setBusy(false);
    if (r.ok && r.data) {
      setReCodes(r.data.backupCodes);
      setReSecret("");
      setReQr("");
      setReCode("");
      setRePw("");
    } else setReMsg(r.error?.message ?? "Помилка");
  }

  async function regenCodes(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBcMsg(null);
    const r = await apiPost<{ backupCodes: string[] }>("/api/auth/backup-codes", { password: bcPw });
    setBusy(false);
    if (r.ok && r.data) {
      setBcCodes(r.data.backupCodes);
      setBcPw("");
    } else setBcMsg(r.error?.message ?? "Помилка");
  }

  async function logoutAll() {
    if (!confirm("Завершити всі інші сесії?")) return;
    await apiPost("/api/auth/logout-all");
    void loadSessions();
  }

  return (
    <div className="settings-cols">
      <section className="card set-card">
        <h3>Зміна пароля</h3>
        <form className="form tight" onSubmit={changePw}>
          <label className="field">
            <span>Поточний пароль</span>
            <input type="password" value={cp.cur} onChange={(e) => setCp({ ...cp, cur: e.target.value })} autoComplete="current-password" required />
          </label>
          <label className="field">
            <span>Новий пароль</span>
            <input type="password" value={cp.n1} onChange={(e) => setCp({ ...cp, n1: e.target.value })} autoComplete="new-password" required />
          </label>
          <label className="field">
            <span>Повторіть</span>
            <input type="password" value={cp.n2} onChange={(e) => setCp({ ...cp, n2: e.target.value })} autoComplete="new-password" required />
          </label>
          {cpMsg ? <p className="form-error">{cpMsg}</p> : null}
          <button className="btn btn-primary btn-sm" disabled={busy}>
            Змінити пароль
          </button>
        </form>
      </section>

      <section className="card set-card">
        <h3>Двофакторна автентифікація</h3>
        {reCodes ? (
          <CodesBox codes={reCodes} />
        ) : !reSecret ? (
          <>
            <p className="sub">Переналаштувати 2ФА (потрібні пароль і код із нового QR).</p>
            <button className="btn btn-sm" onClick={start2fa}>
              Переналаштувати 2ФА
            </button>
          </>
        ) : (
          <form className="form tight" onSubmit={confirm2fa}>
            {reQr ? <img className="enroll-qr-img" src={reQr} alt="QR-код 2ФА" width={200} height={200} /> : null}
            <p className="secret-hint">
              Секрет: <code className="secret">{reSecret}</code>
            </p>
            <label className="field">
              <span>Пароль</span>
              <input type="password" value={rePw} onChange={(e) => setRePw(e.target.value)} required />
            </label>
            <label className="field">
              <span>Код із застосунку</span>
              <input type="text" inputMode="numeric" value={reCode} onChange={(e) => setReCode(e.target.value)} required />
            </label>
            {reMsg ? <p className="form-error">{reMsg}</p> : null}
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Підтвердити
            </button>
          </form>
        )}
      </section>

      <section className="card set-card">
        <h3>Резервні коди</h3>
        {bcCodes ? (
          <CodesBox codes={bcCodes} />
        ) : (
          <form className="form tight" onSubmit={regenCodes}>
            <p className="sub">Згенерувати нові (старі анулюються).</p>
            <label className="field">
              <span>Пароль</span>
              <input type="password" value={bcPw} onChange={(e) => setBcPw(e.target.value)} required />
            </label>
            {bcMsg ? <p className="form-error">{bcMsg}</p> : null}
            <button className="btn btn-sm" disabled={busy}>
              Згенерувати нові коди
            </button>
          </form>
        )}
      </section>

      <section className="card set-card">
        <div className="sec-head">
          <h3>Активні сесії</h3>
          <button className="btn-link" onClick={logoutAll}>
            Вийти всюди
          </button>
        </div>
        <ul className="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              {s.current ? <b>Поточна</b> : "Сесія"} · {s.ip ?? "—"} · від {formatDate(s.createdAt)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
