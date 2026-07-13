import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "../api";
import { useAuth } from "../auth";
import { formatDate } from "../format";
import type { ArticleView } from "../../shared/api";

type EditState = null | { id: number | null; title: string; body: string };

export function TechInfo() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState<ArticleView[]>([]);
  const [status, setStatus] = useState<"loading" | "ok">("loading");
  const [edit, setEdit] = useState<EditState>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await apiGet<ArticleView[]>("/api/articles");
    if (r.ok && r.data) setItems(r.data);
    setStatus("ok");
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit || !edit.title.trim()) return;
    setBusy(true);
    setErr(null);
    const payload = { title: edit.title.trim(), body: edit.body };
    const r = edit.id == null ? await apiPost("/api/articles", payload) : await apiPatch(`/api/articles/${edit.id}`, payload);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error?.message ?? "Помилка збереження");
      return;
    }
    setEdit(null);
    await load();
  }

  async function del(id: number) {
    if (!confirm("Видалити цю статтю?")) return;
    setErr(null);
    const r = await apiDelete(`/api/articles/${id}`);
    if (!r.ok) {
      setErr(r.error?.message ?? "Помилка видалення");
      return;
    }
    await load();
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Технічна інформація по паркінгу</h1>
        {isAdmin && !edit ? (
          <button className="btn btn-primary btn-sm" onClick={() => setEdit({ id: null, title: "", body: "" })}>
            + Додати статтю
          </button>
        ) : null}
      </div>

      {err ? <p className="form-error" role="alert">{err}</p> : null}

      {edit ? (
        <form className="form article-form" onSubmit={save}>
          <p className="form-title">{edit.id == null ? "Нова стаття" : "Редагувати статтю"}</p>
          <label className="field">
            <span>Заголовок *</span>
            <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required autoFocus maxLength={200} />
          </label>
          <label className="field">
            <span>Опис</span>
            <textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={6} />
          </label>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy || !edit.title.trim()}>Зберегти</button>
            <button type="button" className="btn btn-sm" onClick={() => setEdit(null)} disabled={busy}>Скасувати</button>
          </div>
        </form>
      ) : null}

      {status === "loading" ? (
        <p className="sub">Завантаження…</p>
      ) : items.length === 0 && !edit ? (
        <p className="sub">Статей поки немає.{isAdmin ? " Додайте першу — кнопка вгорі." : ""}</p>
      ) : (
        <div className="article-list">
          {items.map((a) => (
            <article key={a.id} className="card-sec article">
              <div className="sec-head">
                <h3>{a.title}</h3>
                {isAdmin ? (
                  <span className="note-acts">
                    <button className="btn-link" onClick={() => setEdit({ id: a.id, title: a.title, body: a.body })}>ред.</button>
                    <button className="btn-link danger" onClick={() => del(a.id)}>видалити</button>
                  </span>
                ) : null}
              </div>
              {a.body ? <div className="article-body">{a.body}</div> : null}
              <div className="note-meta">
                <span>
                  Оновлено {formatDate(a.updatedAt)}
                  {a.updatedByEmail ? ` · ${a.updatedByEmail}` : ""}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
