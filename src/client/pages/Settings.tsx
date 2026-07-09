import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost } from "../api";
import { useAuth } from "../auth";
import { SecuritySettings } from "../components/SecuritySettings";
import { AuditLog } from "../components/AuditLog";
import type { UserView, TempPasswordResult } from "../../shared/api";

type Tab = "users" | "security" | "audit";

export function Settings() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Налаштування</h1>
      </div>
      <div className="tabs settings-tabs">
        <button className={"tab" + (tab === "users" ? " active" : "")} onClick={() => setTab("users")}>
          Користувачі
        </button>
        <button className={"tab" + (tab === "security" ? " active" : "")} onClick={() => setTab("security")}>
          Безпека
        </button>
        <button className={"tab" + (tab === "audit" ? " active" : "")} onClick={() => setTab("audit")}>
          Журнал
        </button>
      </div>
      <div className="set-body">{tab === "users" ? <UsersTab selfId={user?.id ?? -1} /> : tab === "security" ? <SecuritySettings /> : <AuditLog />}</div>
    </div>
  );
}

function UsersTab({ selfId }: { selfId: number }) {
  const [users, setUsers] = useState<UserView[]>([]);
  const [email, setEmail] = useState("");
  const [reveal, setReveal] = useState<TempPasswordResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await apiGet<UserView[]>("/api/users");
    if (r.ok && r.data) setUsers(r.data);
  }
  useEffect(() => {
    void load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await apiPost<TempPasswordResult>("/api/users", { email: email.trim() });
    setBusy(false);
    if (r.ok && r.data) {
      setReveal(r.data);
      setEmail("");
      void load();
    } else setMsg(r.error?.message ?? "Помилка");
  }
  async function reset(id: number) {
    if (!confirm("Скинути пароль і 2ФА цього користувача? Його сесії буде завершено.")) return;
    setMsg(null);
    const r = await apiPost<TempPasswordResult>(`/api/users/${id}/reset-password`);
    if (r.ok && r.data) {
      setReveal(r.data);
      void load();
    } else setMsg(r.error?.message ?? "Помилка");
  }
  async function setActive(id: number, active: boolean) {
    setMsg(null);
    const r = await apiPost(`/api/users/${id}/active`, { active });
    if (r.ok) void load();
    else setMsg(r.error?.message ?? "Помилка");
  }

  return (
    <div>
      {reveal ? (
        <div className="reveal-box">
          <p>
            Тимчасовий пароль для <b>{reveal.email}</b>:
          </p>
          <code className="reveal-pw">{reveal.tempPassword}</code>
          <div className="row-actions">
            <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(reveal.tempPassword)}>
              Копіювати
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setReveal(null)}>
              Я зберіг
            </button>
          </div>
          <p className="sub">Показується один раз. При першому вході користувач змінить пароль і налаштує 2ФА.</p>
        </div>
      ) : null}

      <form className="form tight new-project" onSubmit={add}>
        <label className="field">
          <span>Email нового адміністратора</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {msg ? <p className="form-error">{msg}</p> : null}
        <button className="btn btn-primary btn-sm" disabled={busy}>
          + Додати адміністратора
        </button>
      </form>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Роль</th>
              <th>2ФА</th>
              <th>Стан</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.email}
                  {u.id === selfId ? " (ви)" : ""}
                </td>
                <td>{u.role === "admin" ? "Адміністратор" : "Перегляд"}</td>
                <td>{u.totpEnabled ? "✓" : "—"}</td>
                <td>{u.isActive ? "Активний" : "Деактивований"}</td>
                <td className="num">
                  <button className="btn-link" onClick={() => reset(u.id)}>
                    Скинути пароль
                  </button>
                  {u.id !== selfId ? (
                    <button className="btn-link" onClick={() => setActive(u.id, !u.isActive)}>
                      {u.isActive ? "Деактивувати" : "Активувати"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
