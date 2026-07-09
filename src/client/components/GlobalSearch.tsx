import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import type { SearchResults } from "../../shared/api";

function activeIsField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !activeIsField())) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    const click = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", h);
    window.addEventListener("mousedown", click);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("mousedown", click);
    };
  }, []);

  useEffect(() => {
    if (q.trim().length < 1) {
      setRes(null);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      const r = await apiGet<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if (r.ok && r.data) {
        setRes(r.data);
        setOpen(true);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function go(path: string) {
    setOpen(false);
    setQ("");
    setRes(null);
    nav(path);
  }
  const total = res ? res.spots.length + res.owners.length + res.projects.length : 0;

  return (
    <div className="gsearch" ref={boxRef}>
      <input
        ref={inputRef}
        className="gsearch-input"
        type="search"
        placeholder="Пошук: № / ПІП / авто / телефон…"
        aria-label="Глобальний пошук"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (res) setOpen(true);
        }}
      />
      {open && res ? (
        <div className="gsearch-drop">
          {total === 0 ? <div className="gs-empty">Нічого не знайдено за «{q.trim()}»</div> : null}
          {res.spots.length ? (
            <div className="gs-group">
              <div className="gs-head">Місця</div>
              {res.spots.map((s) => (
                <button key={`s${s.number}`} className="gs-item" onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/spots/${s.number}`)}>
                  <b>№{s.number}</b> · {s.section}
                  {s.ownerName ? ` · ${s.ownerName}` : ""}
                  {s.plate ? ` · ${s.plate}` : ""}
                </button>
              ))}
            </div>
          ) : null}
          {res.owners.length ? (
            <div className="gs-group">
              <div className="gs-head">Власники</div>
              {res.owners.map((o) => (
                <button key={`o${o.id}`} className="gs-item" onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/owners/${o.id}`)}>
                  {o.fullName}
                  {o.phone ? ` · ${o.phone}` : ""}
                </button>
              ))}
            </div>
          ) : null}
          {res.projects.length ? (
            <div className="gs-group">
              <div className="gs-head">Проєкти</div>
              {res.projects.map((p) => (
                <button key={`p${p.id}`} className="gs-item" onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/projects/${p.id}`)}>
                  {p.title}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
