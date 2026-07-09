import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from "../api";
import type { SpotDetail, SpotOwnerView } from "../../shared/api";

interface Props {
  number: number;
  onClose: () => void;
  onChanged: () => void;
}

type OwnerMode = null | { kind: "change" | "coowner" | "fix"; ownerId?: number };

interface OwnerFields {
  fullName: string;
  phone: string;
  phone2: string;
  email: string;
  comment: string;
}
const EMPTY: OwnerFields = { fullName: "", phone: "", phone2: "", email: "", comment: "" };

export function SpotCard({ number, onClose, onChanged }: Props) {
  const [d, setD] = useState<SpotDetail | null>(null);
  const [carEdit, setCarEdit] = useState(false);
  const [car, setCar] = useState({ plate: "", carMake: "", carModel: "" });
  const [ownerMode, setOwnerMode] = useState<OwnerMode>(null);
  const [of, setOf] = useState<OwnerFields>(EMPTY);
  const [note, setNote] = useState("");
  const [editNote, setEditNote] = useState<{ id: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await apiGet<SpotDetail>(`/api/spots/${number}`);
    if (r.ok && r.data) {
      setD(r.data);
      setCar({ plate: r.data.plate ?? "", carMake: r.data.carMake ?? "", carModel: r.data.carModel ?? "" });
    }
  }
  useEffect(() => {
    setCarEdit(false);
    setOwnerMode(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function saveCar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await apiPatch(`/api/spots/${number}`, { plate: car.plate || null, carMake: car.carMake || null, carModel: car.carModel || null });
    setBusy(false);
    setCarEdit(false);
    await load();
    onChanged();
  }

  function openOwner(mode: OwnerMode, o?: SpotOwnerView) {
    setOwnerMode(mode);
    setOf(o ? { fullName: o.fullName, phone: o.phone ?? "", phone2: o.phone2 ?? "", email: o.email ?? "", comment: "" } : EMPTY);
  }

  async function submitOwner(e: FormEvent) {
    e.preventDefault();
    if (!ownerMode || !of.fullName.trim()) return;
    setBusy(true);
    const payload = { fullName: of.fullName.trim(), phone: of.phone || null, phone2: of.phone2 || null, email: of.email || null, comment: of.comment || null };
    if (ownerMode.kind === "change") await apiPut(`/api/spots/${number}/owner`, payload);
    else if (ownerMode.kind === "coowner") await apiPost(`/api/spots/${number}/coowner`, payload);
    else if (ownerMode.kind === "fix" && ownerMode.ownerId) await apiPatch(`/api/owners/${ownerMode.ownerId}`, payload);
    setBusy(false);
    setOwnerMode(null);
    await load();
    onChanged();
  }

  async function clearSpot() {
    if (!confirm(`Очистити місце №${number}? Дані власника буде знято (нотатки збережуться).`)) return;
    setBusy(true);
    await apiDelete(`/api/spots/${number}/owners`);
    setBusy(false);
    await load();
    onChanged();
  }
  async function removeOwner(ownerId: number) {
    setBusy(true);
    await apiDelete(`/api/spots/${number}/owner/${ownerId}`);
    setBusy(false);
    await load();
    onChanged();
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    await apiPost(`/api/spots/${number}/notes`, { body: note.trim() });
    setBusy(false);
    setNote("");
    await load();
  }
  async function saveNoteEdit() {
    if (!editNote) return;
    setBusy(true);
    await apiPatch(`/api/notes/${editNote.id}`, { body: editNote.body });
    setBusy(false);
    setEditNote(null);
    await load();
  }
  async function delNote(id: number) {
    if (!confirm("Видалити нотатку?")) return;
    setBusy(true);
    await apiDelete(`/api/notes/${id}`);
    setBusy(false);
    await load();
  }

  const primary = d?.owners.find((o) => o.isPrimary) ?? null;
  const coowners = d?.owners.filter((o) => !o.isPrimary) ?? [];

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Місце №${number}`}>
        <div className="drawer-head">
          <div>
            <h2>Місце №{number}</h2>
            {d ? (
              <span className="chip">
                Секція {d.section} · {primary ? "Зайняте" : "Вільне"}
              </span>
            ) : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </div>

        {!d ? (
          <p className="sub">Завантаження…</p>
        ) : (
          <div className="drawer-body">
            {/* Авто */}
            <section className="card-sec">
              <div className="sec-head">
                <h3>Автомобіль</h3>
                {!carEdit ? (
                  <button className="btn-link" onClick={() => setCarEdit(true)}>
                    Редагувати
                  </button>
                ) : null}
              </div>
              {carEdit ? (
                <form className="form tight" onSubmit={saveCar}>
                  <label className="field">
                    <span>Номерний знак</span>
                    <input value={car.plate} onChange={(e) => setCar({ ...car, plate: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Марка</span>
                    <input value={car.carMake} onChange={(e) => setCar({ ...car, carMake: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Модель</span>
                    <input value={car.carModel} onChange={(e) => setCar({ ...car, carModel: e.target.value })} />
                  </label>
                  <div className="row-actions">
                    <button className="btn btn-primary btn-sm" disabled={busy}>
                      Зберегти
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setCarEdit(false)}>
                      Скасувати
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="kv">
                  <dt>Номер</dt>
                  <dd className="mono">{d.plate || "—"}</dd>
                  <dt>Марка/модель</dt>
                  <dd>{[d.carMake, d.carModel].filter(Boolean).join(" ") || "—"}</dd>
                </dl>
              )}
            </section>

            {/* Власник */}
            <section className="card-sec">
              <div className="sec-head">
                <h3>Власник</h3>
              </div>
              {primary ? (
                <div className="owner-block">
                  <div className="owner-line">
                    <strong>{primary.fullName}</strong>
                    <div className="owner-acts">
                      <button className="btn-link" onClick={() => openOwner({ kind: "fix", ownerId: primary.ownerId }, primary)}>
                        Виправити
                      </button>
                      <button className="btn-link" onClick={() => openOwner({ kind: "change" })}>
                        Змінити
                      </button>
                    </div>
                  </div>
                  {primary.phone ? (
                    <a className="tel" href={`tel:${primary.phone}`}>
                      {primary.phone}
                    </a>
                  ) : null}
                  {primary.email ? <div className="muted-line">{primary.email}</div> : null}
                </div>
              ) : (
                <p className="sub">Власник не вказаний.</p>
              )}

              {coowners.map((co) => (
                <div key={co.ownerId} className="owner-block coowner">
                  <div className="owner-line">
                    <span>
                      <em>Співвласник:</em> {co.fullName}
                    </span>
                    <button className="btn-link danger" onClick={() => removeOwner(co.ownerId)}>
                      прибрати
                    </button>
                  </div>
                  {co.phone ? (
                    <a className="tel" href={`tel:${co.phone}`}>
                      {co.phone}
                    </a>
                  ) : null}
                </div>
              ))}

              {ownerMode ? (
                <form className="form tight owner-form" onSubmit={submitOwner}>
                  <p className="form-title">
                    {ownerMode.kind === "change" ? "Новий власник" : ownerMode.kind === "coowner" ? "Співвласник" : "Виправити дані"}
                  </p>
                  <label className="field">
                    <span>ПІП *</span>
                    <input value={of.fullName} onChange={(e) => setOf({ ...of, fullName: e.target.value })} required autoFocus />
                  </label>
                  <label className="field">
                    <span>Телефон</span>
                    <input value={of.phone} onChange={(e) => setOf({ ...of, phone: e.target.value })} inputMode="tel" />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input value={of.email} onChange={(e) => setOf({ ...of, email: e.target.value })} />
                  </label>
                  <div className="row-actions">
                    <button className="btn btn-primary btn-sm" disabled={busy}>
                      Зберегти
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setOwnerMode(null)}>
                      Скасувати
                    </button>
                  </div>
                </form>
              ) : (
                <div className="row-actions wrap">
                  {!primary ? (
                    <button className="btn btn-sm" onClick={() => openOwner({ kind: "change" })}>
                      Додати власника
                    </button>
                  ) : null}
                  <button className="btn btn-sm" onClick={() => openOwner({ kind: "coowner" })}>
                    + Співвласник
                  </button>
                  {primary ? (
                    <button className="btn btn-sm danger" onClick={clearSpot}>
                      Очистити місце
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            {/* Історія власників */}
            {d.history.length > 1 ? (
              <section className="card-sec">
                <div className="sec-head">
                  <h3>Історія власників</h3>
                </div>
                <ul className="history">
                  {d.history.map((h, i) => (
                    <li key={i} className={h.endedAt ? "past" : ""}>
                      {h.fullName} {!h.isPrimary ? "(співвл.)" : ""} · {h.startedAt} — {h.endedAt ?? "чинний"}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Нотатки */}
            <section className="card-sec">
              <div className="sec-head">
                <h3>Нотатки</h3>
              </div>
              <form className="note-add" onSubmit={addNote}>
                <input placeholder="Додати нотатку…" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn btn-sm" disabled={busy || !note.trim()}>
                  Додати
                </button>
              </form>
              <ul className="notes">
                {d.notes.map((n) => (
                  <li key={n.id} className={n.kind === "project_auto" ? "auto" : ""}>
                    {editNote?.id === n.id ? (
                      <div className="note-edit">
                        <input value={editNote.body} onChange={(e) => setEditNote({ id: n.id, body: e.target.value })} />
                        <button className="btn-link" onClick={saveNoteEdit}>
                          зберегти
                        </button>
                        <button className="btn-link" onClick={() => setEditNote(null)}>
                          скасувати
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="note-body">
                          {n.kind === "project_auto" ? <span className="note-badge">📌 авто</span> : null}
                          {n.body}
                        </div>
                        <div className="note-meta">
                          <span>
                            {n.createdAt.slice(0, 10)}
                            {n.createdByEmail ? ` · ${n.createdByEmail}` : ""}
                          </span>
                          {n.kind === "manual" ? (
                            <span className="note-acts">
                              <button className="btn-link" onClick={() => setEditNote({ id: n.id, body: n.body })}>
                                ред.
                              </button>
                              <button className="btn-link danger" onClick={() => delNote(n.id)}>
                                видалити
                              </button>
                            </span>
                          ) : null}
                        </div>
                      </>
                    )}
                  </li>
                ))}
                {d.notes.length === 0 ? <li className="empty">Нотаток ще немає.</li> : null}
              </ul>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
