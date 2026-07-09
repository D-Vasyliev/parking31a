import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { formatKop } from "../format";
import type { ProjectListItem, ProjectDetail, ProjectStatus } from "../../shared/api";

const STATUS_LABEL: Record<ProjectStatus, string> = { draft: "Чернетка", active: "Активний", completed: "Завершений", archived: "Архів" };

function parseKop(v: string): number {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function Projects() {
  const nav = useNavigate();
  const [list, setList] = useState<ProjectListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await apiGet<ProjectListItem[]>("/api/projects");
    if (r.ok && r.data) setList(r.data);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await apiPost<ProjectDetail>("/api/projects", { title: title.trim(), description: desc || null, totalKop: parseKop(total) });
    setBusy(false);
    if (r.ok && r.data) nav(`/projects/${r.data.id}`);
    else setErr(r.error?.message ?? "Помилка");
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Проєкти</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
          + Новий проєкт
        </button>
      </div>

      {creating ? (
        <form className="form new-project" onSubmit={create}>
          <label className="field">
            <span>Назва</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>Опис</span>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <label className="field">
            <span>Загальна вартість, грн</span>
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="120000" required />
          </label>
          {err ? <p className="form-error">{err}</p> : null}
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Створити
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setCreating(false)}>
              Скасувати
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Назва</th>
              <th>Статус</th>
              <th>Вартість</th>
              <th>Учасників</th>
              <th>Зібрано</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/projects/${p.id}`}>{p.title}</Link>
                </td>
                <td>
                  <span className={`pstatus ${p.status}`}>{p.cancelled ? "Скасований" : STATUS_LABEL[p.status]}</span>
                </td>
                <td className="num">{formatKop(p.totalKop)}</td>
                <td className="num">
                  {p.paidCount}/{p.spotCount}
                </td>
                <td className="num">{formatKop(p.collectedKop)}</td>
              </tr>
            ))}
            {list.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Проєктів ще немає — створіть перший.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
