import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost, apiPatch, apiDelete, apiPut, type ApiResult } from "../api";
import { formatKop, formatDate, parseKop } from "../format";
import { MapPicker } from "../components/MapPicker";
import { Attachments } from "../components/Attachments";
import { useAuth } from "../auth";
import type { ProjectDetail as PD, ProjectParticipant, PaymentMethod } from "../../shared/api";

const STATUS_LABEL = { draft: "Чернетка", active: "Активний", completed: "Завершений", archived: "Архів" } as const;

function payStatusText(p: ProjectParticipant): string {
  if (p.status === "unpaid") return "Не сплачено";
  if (p.status === "paid") return "Сплачено";
  if (p.status === "overpaid") return `Переплата ${formatKop(p.delta)}`;
  return `Доплата ${formatKop(-p.delta)}`;
}

export function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [p, setP] = useState<PD | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", total: "" });
  const [payRow, setPayRow] = useState<number | null>(null);
  const [pay, setPay] = useState<{ method: PaymentMethod; note: string; date: string }>({ method: "cash", note: "", date: "" });
  const [picker, setPicker] = useState(false);

  async function load() {
    const r = await apiGet<PD>(`/api/projects/${id}`);
    if (r.ok && r.data) {
      setP(r.data);
      setForm({ title: r.data.title, description: r.data.description ?? "", total: (r.data.totalKop / 100).toFixed(2) });
      setState("ok");
    } else if (r.status === 404) setState("notfound");
    else setState((s) => (s === "loading" ? "error" : s));
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function mutate(pr: Promise<ApiResult<unknown>>, after?: () => void) {
    setErr(null);
    setBusy(true);
    const r = await pr;
    setBusy(false);
    if (!r.ok) {
      setErr(r.error?.message ?? "Помилка");
      return false;
    }
    after?.();
    await load();
    return true;
  }

  const transition = (t: string) => mutate(apiPost(`/api/projects/${id}/status/${t}`));

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    const kop = parseKop(form.total);
    if (kop === null) {
      setErr("Некоректна вартість");
      return;
    }
    if (p && p.status === "active" && kop !== p.totalKop && p.participants.some((x) => x.paidAt)) {
      const n = p.participants.length;
      const newBase = n ? Math.floor(kop / n) : 0;
      if (!confirm(`Змінити вартість? Частка стане ≈ ${formatKop(newBase)}. У сплачених місць виникне переплата/доплата.`)) return;
    }
    await mutate(apiPatch(`/api/projects/${id}`, { title: form.title, description: form.description || null, totalKop: kop }), () => setEdit(false));
  }
  async function del() {
    if (!confirm("Видалити чернетку проєкту?")) return;
    const r = await apiDelete(`/api/projects/${id}`);
    if (r.ok) nav("/projects");
    else setErr(r.error?.message ?? "Помилка");
  }
  async function submitPay(e: FormEvent) {
    e.preventDefault();
    if (payRow == null) return;
    await mutate(
      apiPost(`/api/projects/${id}/payments`, { numbers: [payRow], paymentMethod: pay.method, paymentNote: pay.note || null, paidAt: pay.date || undefined }),
      () => setPayRow(null),
    );
  }
  async function cancelPay(number: number) {
    const reason = prompt("Причина скасування оплати:");
    if (!reason) return;
    await mutate(apiPost(`/api/projects/${id}/payments/cancel`, { number, reason }));
  }
  async function complete() {
    if (!p) return;
    const unpaid = p.participants.filter((x) => !x.paidAt);
    const paid = p.participants.length - unpaid.length;
    const list = unpaid.slice(0, 12).map((x) => `№${x.number}${x.ownerName ? ` (${x.ownerName})` : ""}`).join(", ") + (unpaid.length > 12 ? "…" : "");
    const msg = `Завершити «${p.title}»?\n\nСплатили: ${paid} (${formatKop(p.collectedKop)}).\nНе сплатили: ${unpaid.length}${unpaid.length ? ": " + list : ""}.\n\nМісцям, що сплатили, буде додано автоматичну нотатку.`;
    if (!confirm(msg)) return;
    await transition("complete");
  }
  async function saveSpots(numbers: number[]) {
    const paidCount = p?.participants.filter((x) => x.paidAt).length ?? 0;
    if (p && p.status === "active" && paidCount > 0) {
      const newBase = numbers.length ? Math.floor(p.totalKop / numbers.length) : 0;
      if (!confirm(`Змінити склад на ${numbers.length} місць? Нова частка ≈ ${formatKop(newBase)}; у ${paidCount} сплачених місць зміниться дельта.`)) return;
    }
    setPicker(false);
    await mutate(apiPut(`/api/projects/${id}/spots`, { numbers }));
  }

  if (state === "loading") return <div className="page"><p className="sub">Завантаження…</p></div>;
  if (state === "error") return <div className="page"><p className="sub">Помилка завантаження. <button className="btn-link" onClick={() => void load()}>Повторити</button></p></div>;
  if (state === "notfound" || !p) return <div className="page"><p className="sub">Проєкт не знайдено.</p></div>;

  const n = p.participants.length;
  const base = n ? Math.floor(p.totalKop / n) : 0;
  const remainder = n ? p.totalKop - base * n : 0;
  const paidCount = p.participants.filter((x) => x.paidAt).length;
  const pct = p.totalKop ? Math.min(100, Math.round((p.collectedKop / p.totalKop) * 100)) : 0;
  const editable = p.status === "draft" || p.status === "active";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{p.title}</h1>
          <span className={`pstatus ${p.status}`}>{p.cancelled ? "Скасований" : STATUS_LABEL[p.status]}</span>
          {p.description ? <p className="sub">{p.description}</p> : null}
        </div>
        <div className="row-actions wrap">
          {p.status === "draft" ? (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => transition("activate")}>Активувати</button>
              <button className="btn btn-sm" onClick={() => setEdit((v) => !v)}>Редагувати</button>
              <button className="btn btn-sm danger" disabled={busy} onClick={del}>Видалити</button>
            </>
          ) : null}
          {p.status === "active" ? (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={complete}>Завершити</button>
              <button className="btn btn-sm" onClick={() => setEdit((v) => !v)}>Редагувати</button>
              <button
                className="btn btn-sm"
                disabled={busy || paidCount > 0}
                title={paidCount > 0 ? "Спершу скасуйте оплати" : undefined}
                onClick={() => transition("to_draft")}
              >
                У чернетку
              </button>
              <button className="btn btn-sm danger" disabled={busy} onClick={() => transition("cancel")}>Скасувати проєкт</button>
            </>
          ) : null}
          {p.status === "completed" ? (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={() => transition("uncomplete")}>Повернути в активні</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => transition("archive")}>Архівувати</button>
            </>
          ) : null}
          {p.status === "archived" && !p.cancelled ? (
            <button className="btn btn-sm" disabled={busy} onClick={() => transition("unarchive")}>Розархівувати</button>
          ) : null}
        </div>
      </div>

      {err ? <p className="form-error">{err}</p> : null}

      {edit && editable ? (
        <form className="form new-project" onSubmit={saveEdit}>
          <label className="field"><span>Назва</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <label className="field"><span>Опис</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="field"><span>Вартість, грн</span><input value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} inputMode="decimal" /></label>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy}>Зберегти</button>
            <button type="button" className="btn btn-sm" onClick={() => setEdit(false)}>Скасувати</button>
          </div>
        </form>
      ) : null}

      <div className="calc">
        <div className="calc-formula">
          {n === 0 ? (
            <>{formatKop(p.totalKop)} · без учасників</>
          ) : remainder > 0 ? (
            <>
              {formatKop(base + 1)} × {remainder} + {formatKop(base)} × {n - remainder} = <b>{formatKop(p.totalKop)}</b>
            </>
          ) : (
            <>
              {formatKop(p.totalKop)} ÷ {n} = <b>{formatKop(base)}</b> / місце
            </>
          )}
          <button type="button" className="hint" aria-label="Копійчаний залишок розподілено по +1 коп. місцям з найменшими номерами" title="Копійчаний залишок розподілено по +1 коп. місцям з найменшими номерами">
            ⓘ
          </button>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Прогрес збору">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="calc-sub">
          Зібрано <b>{formatKop(p.collectedKop)}</b> з {formatKop(p.totalKop)} · {paidCount}/{p.participants.length} місць
        </div>
      </div>

      <div className="sec-head">
        <h3>Учасники ({p.participants.length})</h3>
        {editable ? (
          <button className="btn btn-sm" onClick={() => setPicker(true)}>Додати/прибрати місця</button>
        ) : null}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>№</th><th>Власник</th><th>Частка</th><th>Статус</th><th>Дата</th><th></th></tr>
          </thead>
          <tbody>
            {p.participants.map((x) => (
              <tr key={x.spotId}>
                <td><Link to={`/spots/${x.number}`}>№{x.number}</Link></td>
                <td>{x.ownerName ?? "—"}</td>
                <td className="num">{formatKop(x.shareKop)}</td>
                <td><span className={`pay ${x.status}`}>{payStatusText(x)}</span></td>
                <td>{x.paidAt ? formatDate(x.paidAt) : "—"}</td>
                <td className="num">
                  {p.status === "active" ? (
                    x.paidAt ? (
                      <button className="btn-link danger" onClick={() => cancelPay(x.number)}>Скасувати</button>
                    ) : (
                      <button className="btn-link" onClick={() => { setPayRow(x.number); setPay({ method: "cash", note: "", date: "" }); }}>Позначити</button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
            {p.participants.length === 0 ? <tr><td colSpan={6} className="empty">Місць ще не додано.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="card-sec">
        <Attachments entityType="project" entityId={p.id} canEdit={isAdmin} />
      </div>

      {payRow != null ? (
        <form className="form pay-form" onSubmit={submitPay}>
          <p className="form-title">Оплата місця №{payRow}</p>
          <label className="field"><span>Дата</span><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></label>
          <label className="field">
            <span>Спосіб</span>
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
              <option value="cash">Готівка</option>
              <option value="transfer">Переказ</option>
              <option value="other">Інше</option>
            </select>
          </label>
          <label className="field"><span>Коментар</span><input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy}>Підтвердити</button>
            <button type="button" className="btn btn-sm" onClick={() => setPayRow(null)}>Скасувати</button>
          </div>
        </form>
      ) : null}

      {picker ? (
        <MapPicker
          initial={new Set(p.participants.map((x) => x.number))}
          locked={new Set(p.participants.filter((x) => x.paidAt).map((x) => x.number))}
          totalKop={p.totalKop}
          onSave={saveSpots}
          onCancel={() => setPicker(false)}
        />
      ) : null}
    </div>
  );
}
