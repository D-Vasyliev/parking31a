import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { apiGet, apiDelete } from "../api";
import type { AttachmentView, AttachmentEntityType } from "../../shared/api";

const MAX_BYTES = 100 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
const isPdf = (a: AttachmentView) => a.contentType === "application/pdf";
const isImg = (a: AttachmentView) => a.contentType.startsWith("image/") && a.contentType !== "image/svg+xml";
const isDocx = (a: AttachmentView) => a.contentType.includes("wordprocessingml") || /\.docx$/i.test(a.filename);
const canPreview = (a: AttachmentView) => isPdf(a) || isImg(a) || isDocx(a);
const rawUrl = (id: number) => `/api/files/${id}/raw`;

function uploadFile(entityType: AttachmentEntityType, entityId: number, file: File, onProgress: (pct: number) => void): Promise<{ ok: boolean; status: number; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files?entityType=${entityType}&entityId=${entityId}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let error: string | undefined;
      try { error = JSON.parse(xhr.responseText)?.error?.message; } catch { /* ignore */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, error });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, error: "Немає з'єднання" });
    xhr.send(file);
  });
}

export function Attachments({ entityType, entityId, canEdit }: { entityType: AttachmentEntityType; entityId: number; canEdit: boolean }) {
  const [items, setItems] = useState<AttachmentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<AttachmentView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const r = await apiGet<AttachmentView[]>(`/api/files?entityType=${entityType}&entityId=${entityId}`);
    if (r.ok && r.data) setItems(r.data);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setErr(null);
    if (file.size > MAX_BYTES) {
      setErr("Файл більший за 100 МБ");
      return;
    }
    setBusy(true);
    setProgress(0);
    const r = await uploadFile(entityType, entityId, file, setProgress);
    setBusy(false);
    setProgress(null);
    if (!r.ok) setErr(r.error ?? "Не вдалося завантажити файл");
    await load();
  }

  async function del(a: AttachmentView) {
    if (!confirm(`Видалити файл «${a.filename}»?`)) return;
    setErr(null);
    const r = await apiDelete(`/api/files/${a.id}`);
    if (!r.ok) setErr(r.error?.message ?? "Помилка видалення");
    await load();
  }

  return (
    <div className="attachments">
      <div className="att-head">
        <h4>Файли {items.length ? `(${items.length})` : ""}</h4>
        {canEdit ? (
          <>
            <input ref={inputRef} type="file" hidden onChange={onPick} disabled={busy} aria-label="Прикріпити файл" />
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              📎 Прикріпити
            </button>
          </>
        ) : null}
      </div>

      {progress !== null ? (
        <div className="upl">
          <div className="upl-bar" style={{ width: `${progress}%` }} />
          <span className="upl-pct">{progress}%</span>
        </div>
      ) : null}
      {err ? <p className="form-error">{err}</p> : null}

      {items.length === 0 ? (
        <p className="sub att-empty">Файлів немає.</p>
      ) : (
        <ul className="att-list">
          {items.map((a) => (
            <li key={a.id} className="att-item">
              <span className="att-ico">{isPdf(a) ? "📄" : isImg(a) ? "🖼️" : isDocx(a) ? "📝" : "📎"}</span>
              <span className="att-name" title={a.filename}>{a.filename}</span>
              <span className="att-size">{fmtBytes(a.size)}</span>
              <span className="att-acts">
                {canPreview(a) ? <button className="btn-link" onClick={() => setView(a)}>Переглянути</button> : null}
                <a className="btn-link" href={`${rawUrl(a.id)}?download=1`}>Завантажити</a>
                {canEdit ? <button className="btn-link danger" onClick={() => del(a)}>видалити</button> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {view ? <FileViewer att={view} onClose={() => setView(null)} /> : null}
    </div>
  );
}

function FileViewer({ att, onClose }: { att: AttachmentView; onClose: () => void }) {
  const docxRef = useRef<HTMLDivElement>(null);
  const [docxState, setDocxState] = useState<"idle" | "loading" | "error">(isDocx(att) ? "loading" : "idle");

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    if (!isDocx(att)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(rawUrl(att.id), { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !docxRef.current) return;
        docxRef.current.innerHTML = "";
        await renderAsync(blob, docxRef.current, undefined, { inWrapper: true, className: "docx" });
        if (!cancelled) setDocxState("idle");
      } catch {
        if (!cancelled) setDocxState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [att]);

  return (
    <div className="fv-overlay" onClick={onClose}>
      <div className="fv-modal" role="dialog" aria-modal="true" aria-label={att.filename} onClick={(e) => e.stopPropagation()}>
        <div className="fv-head">
          <span className="att-name" title={att.filename}>{att.filename}</span>
          <span className="att-acts">
            <a className="btn-link" href={`${rawUrl(att.id)}?download=1`}>Завантажити</a>
            <button className="icon-btn" onClick={onClose} aria-label="Закрити">✕</button>
          </span>
        </div>
        <div className="fv-body">
          {isPdf(att) ? (
            <iframe className="fv-frame" src={rawUrl(att.id)} title={att.filename} />
          ) : isImg(att) ? (
            <img className="fv-img" src={rawUrl(att.id)} alt={att.filename} />
          ) : isDocx(att) ? (
            <>
              {docxState === "loading" ? <p className="sub">Рендеринг документа…</p> : null}
              {docxState === "error" ? <p className="form-error">Не вдалося показати документ. <a href={`${rawUrl(att.id)}?download=1`}>Завантажити</a></p> : null}
              <div ref={docxRef} className="fv-docx" />
            </>
          ) : (
            <p className="sub">Прев'ю для цього типу недоступне. <a href={`${rawUrl(att.id)}?download=1`}>Завантажити файл</a></p>
          )}
        </div>
      </div>
    </div>
  );
}
