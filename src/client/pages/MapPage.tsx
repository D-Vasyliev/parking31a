import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "../api";
import { ParkingMap } from "../map/ParkingMap";
import { LEVEL_META, type LevelKey } from "../map/geometry";
import { SpotCard } from "../components/SpotCard";
import { SelectionPanel } from "../components/SelectionPanel";
import type { SpotSummary, ProjectListItem } from "../../shared/api";

export function MapPage() {
  const { number } = useParams();
  const nav = useNavigate();
  const [spots, setSpots] = useState<SpotSummary[]>([]);
  const [level, setLevel] = useState<LevelKey>("F1");
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState<number | null>(null);
  const [activeProjects, setActiveProjects] = useState(0);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  async function load() {
    const r = await apiGet<SpotSummary[]>("/api/spots");
    if (r.ok && r.data) setSpots(r.data);
    const pr = await apiGet<ProjectListItem[]>("/api/projects");
    if (pr.ok && pr.data) setActiveProjects(pr.data.filter((x) => x.status === "active").length);
  }
  useEffect(() => {
    void load();
  }, []);

  const byNumber = useMemo(() => {
    const m = new Map<number, SpotSummary>();
    for (const s of spots) m.set(s.number, s);
    return m;
  }, [spots]);

  const parsedNum = number ? Number(number) : null;
  const selected = parsedNum != null && Number.isInteger(parsedNum) ? parsedNum : null;
  useEffect(() => {
    if (selected != null) {
      const s = byNumber.get(selected);
      if (s) setLevel(s.sheet === 1 ? "F1" : "F2");
    }
  }, [selected, byNumber]);

  useEffect(() => {
    if (highlight == null) return;
    const t = setTimeout(() => setHighlight(null), 2200);
    return () => clearTimeout(t);
  }, [highlight]);

  // Esc знімає мультивибір
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(new Set());
        setSelectMode(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const levelSpots = useMemo(() => spots.filter((s) => (level === "F1" ? s.sheet === 1 : s.sheet === 2)), [spots, level]);
  const occupied = levelSpots.filter((s) => s.occupied).length;
  const selectedSpots = useMemo(() => spots.filter((s) => selection.has(s.number)).sort((a, b) => a.number - b.number), [spots, selection]);

  function handleSelect(n: number, toggle: boolean) {
    if (toggle) {
      setSelection((prev) => {
        const s = new Set(prev);
        if (s.has(n)) s.delete(n);
        else s.add(n);
        return s;
      });
    } else {
      nav(`/spots/${n}`);
    }
  }

  function doSearch(v: string) {
    setSearch(v);
    const n = parseInt(v, 10);
    const s = !isNaN(n) ? byNumber.get(n) : undefined;
    if (s) {
      setLevel(s.sheet === 1 ? "F1" : "F2");
      setHighlight(n);
    } else {
      setHighlight(null);
    }
  }

  return (
    <div className="map-page">
      <div className="map-toolbar">
        <div className="tabs">
          {(["F1", "F2"] as LevelKey[]).map((k) => (
            <button key={k} type="button" className={"tab" + (level === k ? " active" : "")} onClick={() => setLevel(k)}>
              {LEVEL_META[k].title} <span className="cnt">{LEVEL_META[k].range}</span>
            </button>
          ))}
        </div>
        <input
          className="map-search"
          placeholder="Знайти місце за №…"
          value={search}
          onChange={(e) => doSearch(e.target.value)}
          inputMode="numeric"
          aria-label="Пошук місця за номером"
        />
        <button
          type="button"
          className={"btn btn-sm" + (selectMode ? " btn-primary" : "")}
          onClick={() => setSelectMode((v) => !v)}
          title="Клацання по місцях перемикає вибір (або Ctrl+клік)"
        >
          {selectMode ? "Режим вибору ✓" : "Вибрати"}
        </button>
        <div className="map-stats">
          <span className="legend-dot free" /> Вільно: <b>{levelSpots.length - occupied}</b>
          <span className="legend-dot occupied" /> Зайнято: <b>{occupied}</b> / {levelSpots.length}
          <span className="legend-dot debt" /> З боргом: <b>{spots.filter((s) => s.hasDebt).length}</b>
          <span className="stat-sep">·</span> Активних проєктів: <b>{activeProjects}</b>
        </div>
      </div>

      <ParkingMap level={level} occupancy={byNumber} selected={selected} highlight={highlight} onSelect={handleSelect} multi={selection} selectMode={selectMode} />

      {selection.size > 0 ? (
        <SelectionPanel
          spots={selectedSpots}
          onClear={() => {
            setSelection(new Set());
            setSelectMode(false);
          }}
          onChanged={load}
        />
      ) : selected != null ? (
        <SpotCard number={selected} onClose={() => nav("/")} onChanged={load} />
      ) : null}
    </div>
  );
}
