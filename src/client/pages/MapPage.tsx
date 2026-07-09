import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "../api";
import { ParkingMap } from "../map/ParkingMap";
import { LEVEL_META, type LevelKey } from "../map/geometry";
import { SpotCard } from "../components/SpotCard";
import type { SpotSummary } from "../../shared/api";

export function MapPage() {
  const { number } = useParams();
  const nav = useNavigate();
  const [spots, setSpots] = useState<SpotSummary[]>([]);
  const [level, setLevel] = useState<LevelKey>("AB");
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState<number | null>(null);

  async function load() {
    const r = await apiGet<SpotSummary[]>("/api/spots");
    if (r.ok && r.data) setSpots(r.data);
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
      if (s) setLevel(s.sheet === 1 ? "AB" : "VG");
    }
  }, [selected, byNumber]);

  useEffect(() => {
    if (highlight == null) return;
    const t = setTimeout(() => setHighlight(null), 2200);
    return () => clearTimeout(t);
  }, [highlight]);

  const levelSpots = useMemo(() => spots.filter((s) => (level === "AB" ? s.sheet === 1 : s.sheet === 2)), [spots, level]);
  const occupied = levelSpots.filter((s) => s.occupied).length;

  function doSearch(v: string) {
    setSearch(v);
    const n = parseInt(v, 10);
    const s = !isNaN(n) ? byNumber.get(n) : undefined;
    if (s) {
      setLevel(s.sheet === 1 ? "AB" : "VG");
      setHighlight(n);
    } else {
      setHighlight(null);
    }
  }

  return (
    <div className="map-page">
      <div className="map-toolbar">
        <div className="tabs">
          {(["AB", "VG"] as LevelKey[]).map((k) => (
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
        <div className="map-stats">
          <span className="legend-dot free" /> Вільно: <b>{levelSpots.length - occupied}</b>
          <span className="legend-dot occupied" /> Зайнято: <b>{occupied}</b> / {levelSpots.length}
        </div>
      </div>

      <ParkingMap level={level} occupancy={byNumber} selected={selected} highlight={highlight} onSelect={(n) => nav(`/spots/${n}`)} />

      {selected != null ? <SpotCard number={selected} onClose={() => nav("/")} onChanged={load} /> : null}
    </div>
  );
}
