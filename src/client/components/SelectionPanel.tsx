import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import type { SpotSummary, ProjectListItem, ProjectDetail } from "../../shared/api";

interface Props {
  spots: SpotSummary[];
  onClear: () => void;
  onChanged: () => void;
}

export function SelectionPanel({ spots, onClear, onChanged }: Props) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [addId, setAddId] = useState<string>("");
  const [payId, setPayId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const numbers = spots.map((s) => s.number);

  useEffect(() => {
    apiGet<ProjectListItem[]>("/api/projects").then((r) => {
      if (r.ok && r.data) setProjects(r.data);
    });
  }, []);

  function copy() {
    const tsv = ["№\tПІП\tТелефон\tАвто\tБорг", ...spots.map((s) => `${s.number}\t${s.ownerName ?? ""}\t${s.ownerPhone ?? ""}\t${s.plate ?? ""}\t${s.hasDebt ? "так" : ""}`)].join("\n");
    void navigator.clipboard?.writeText(tsv);
    setMsg("Скопійовано в буфер");
  }
  function exportCsv() {
    const rows = [
      ["№", "ПІП", "Телефон", "Авто", "Секція", "Борг"],
      ...spots.map((s) => [s.number, s.ownerName ?? "", s.ownerPhone ?? "", s.plate ?? "", s.section, s.hasDebt ? "так" : ""]),
    ];
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spots_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function addToProject() {
    if (!addId) return;
    setBusy(true);
    setMsg(null);
    const r = await apiGet<ProjectDetail>(`/api/projects/${addId}`);
    if (!r.ok || !r.data) {
      setBusy(false);
      setMsg("Помилка");
      return;
    }
    const union = Array.from(new Set([...r.data.participants.map((p) => p.number), ...numbers]));
    const put = await apiPut(`/api/projects/${addId}/spots`, { numbers: union });
    setBusy(false);
    setMsg(put.ok ? `Додано ${numbers.length} місць до проєкту` : (put.error?.message ?? "Помилка"));
    if (put.ok) onChanged();
  }
  async function markPaid() {
    if (!payId) return;
    setBusy(true);
    setMsg(null);
    const r = await apiPost(`/api/projects/${payId}/payments`, { numbers });
    setBusy(false);
    setMsg(r.ok ? "Оплату позначено" : (r.error?.message ?? "Помилка"));
    if (r.ok) onChanged();
  }

  const editable = projects.filter((p) => p.status === "draft" || p.status === "active");
  const active = projects.filter((p) => p.status === "active");

  return (
    <aside className="drawer" role="dialog" aria-label="Обрані місця">
      <div className="drawer-head">
        <h2>Обрано: {spots.length}</h2>
        <button className="icon-btn" onClick={onClear} aria-label="Зняти виділення">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>ПІП</th>
                <th>Телефон</th>
                <th>Авто</th>
              </tr>
            </thead>
            <tbody>
              {spots.map((s) => (
                <tr key={s.number}>
                  <td>
                    №{s.number}
                    {s.hasDebt ? <span className="pm-debt-dot" title="Має борг" /> : null}
                  </td>
                  <td>{s.ownerName ?? "— вільне"}</td>
                  <td>{s.ownerPhone ?? "—"}</td>
                  <td className="mono">{s.plate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row-actions wrap sel-actions">
          <button className="btn btn-sm" onClick={copy}>
            Копіювати
          </button>
          <button className="btn btn-sm" onClick={exportCsv}>
            Експорт CSV
          </button>
        </div>

        <div className="sel-op">
          <select aria-label="Проєкт для додавання" value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">Проєкт…</option>
            {editable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" disabled={busy || !addId} onClick={addToProject}>
            Додати до проєкту
          </button>
        </div>

        <div className="sel-op">
          <select aria-label="Активний проєкт для оплати" value={payId} onChange={(e) => setPayId(e.target.value)}>
            <option value="">Активний проєкт…</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" disabled={busy || !payId} onClick={markPaid}>
            Позначити оплату
          </button>
        </div>

        {msg ? <p className="sel-msg">{msg}</p> : null}
      </div>
    </aside>
  );
}
