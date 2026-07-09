import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api";
import type { OwnerDetail as OD } from "../../shared/api";

export function OwnerDetail() {
  const { id } = useParams();
  const [o, setO] = useState<OD | null>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ fullName: "", phone: "", phone2: "", email: "", comment: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await apiGet<OD>(`/api/owners/${id}`);
    if (r.ok && r.data) {
      setO(r.data);
      setF({
        fullName: r.data.fullName,
        phone: r.data.phone ?? "",
        phone2: r.data.phone2 ?? "",
        email: r.data.email ?? "",
        comment: r.data.comment ?? "",
      });
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await apiPatch(`/api/owners/${id}`, {
      fullName: f.fullName,
      phone: f.phone || null,
      phone2: f.phone2 || null,
      email: f.email || null,
      comment: f.comment || null,
    });
    setBusy(false);
    setEdit(false);
    await load();
  }

  if (!o) return <div className="page"><p className="sub">Завантаження…</p></div>;

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>{o.fullName}</h1>
        {!edit ? (
          <button className="btn btn-sm" onClick={() => setEdit(true)}>
            Редагувати
          </button>
        ) : null}
      </div>

      {edit ? (
        <form className="form" onSubmit={save}>
          <label className="field">
            <span>ПІП</span>
            <input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
          </label>
          <label className="field">
            <span>Телефон</span>
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" />
          </label>
          <label className="field">
            <span>Додатковий телефон</span>
            <input value={f.phone2} onChange={(e) => setF({ ...f, phone2: e.target.value })} inputMode="tel" />
          </label>
          <label className="field">
            <span>Email</span>
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          <label className="field">
            <span>Примітка</span>
            <input value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
          </label>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Зберегти
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEdit(false)}>
              Скасувати
            </button>
          </div>
        </form>
      ) : (
        <dl className="kv">
          <dt>Телефон</dt>
          <dd>{o.phone ? <a href={`tel:${o.phone}`}>{o.phone}</a> : "—"}</dd>
          {o.phone2 ? (
            <>
              <dt>Додатковий</dt>
              <dd>{o.phone2}</dd>
            </>
          ) : null}
          <dt>Email</dt>
          <dd>{o.email || "—"}</dd>
          {o.comment ? (
            <>
              <dt>Примітка</dt>
              <dd>{o.comment}</dd>
            </>
          ) : null}
        </dl>
      )}

      <section className="card-sec">
        <div className="sec-head">
          <h3>Місця ({o.spots.length})</h3>
        </div>
        <div className="chips">
          {o.spots.map((s) => (
            <Link key={s.number} className="spot-chip" to={`/spots/${s.number}`}>
              №{s.number} · {s.section}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
