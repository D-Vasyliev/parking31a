import { useEffect, useState } from "react";
import { apiGet } from "../api";
import type { AuditEntryView } from "../../shared/api";

const ACTIONS = [
  "",
  "auth.login_ok",
  "auth.login_fail",
  "auth.lockout",
  "auth.logout",
  "payment.mark",
  "payment.cancel",
  "project.status_change",
  "project.create",
  "spot.owner_change",
  "user.create",
  "user.reset",
];

export function AuditLog() {
  const [rows, setRows] = useState<AuditEntryView[]>([]);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (action) qs.set("action", action);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    qs.set("limit", "200");
    const r = await apiGet<AuditEntryView[]>(`/api/audit?${qs.toString()}`);
    if (r.ok && r.data) setRows(r.data);
    setLoading(false);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, from, to]);

  return (
    <div>
      <div className="audit-filters">
        <label className="field">
          <span>Дія</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a || "усі дії"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Від</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>До</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Час</th>
              <th>Користувач</th>
              <th>Дія</th>
              <th>Об'єкт</th>
              <th>Деталі</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.at.slice(0, 19).replace("T", " ")}</td>
                <td>{r.userEmail ?? "—"}</td>
                <td>{r.action}</td>
                <td>{r.entityType ? `${r.entityType} ${r.entityId ?? ""}` : "—"}</td>
                <td className="audit-payload">{r.payload ?? ""}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  {loading ? "Завантаження…" : "Записів не знайдено"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
