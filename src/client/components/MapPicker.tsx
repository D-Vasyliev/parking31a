import { useEffect, useState } from "react";
import { ParkingMap } from "../map/ParkingMap";
import { LEVEL_META, type LevelKey } from "../map/geometry";
import { formatKop } from "../format";
import type { SpotSummary } from "../../shared/api";

const EMPTY = new Map<number, SpotSummary>();

interface Props {
  initial: Set<number>;
  locked: Set<number>;
  totalKop: number;
  onSave: (numbers: number[]) => void;
  onCancel: () => void;
}

export function MapPicker({ initial, locked, totalKop, onSave, onCancel }: Props) {
  const [chosen, setChosen] = useState<Set<number>>(new Set(initial));
  const [level, setLevel] = useState<LevelKey>("F1");

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onCancel]);

  function toggle(n: number) {
    setChosen((prev) => {
      const s = new Set(prev);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });
  }

  const count = chosen.size;
  const share = count > 0 ? Math.floor(totalKop / count) : 0;

  return (
    <div className="picker-overlay" role="dialog" aria-modal="true" aria-label="Вибір місць проєкту">
      <div className="picker">
        <div className="picker-head">
          <strong>Місця проєкту</strong>
          <div className="tabs">
            {(["F1", "F2"] as LevelKey[]).map((k) => (
              <button key={k} type="button" className={"tab" + (level === k ? " active" : "")} onClick={() => setLevel(k)}>
                {LEVEL_META[k].title}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Закрити">
            ✕
          </button>
        </div>
        <div className="picker-map">
          <ParkingMap level={level} occupancy={EMPTY} selected={null} highlight={null} onSelect={toggle} picker chosen={chosen} locked={locked} />
        </div>
        <div className="picker-foot">
          <span>
            Обрано: <b>{count}</b> · частка ≈ <b>{formatKop(share)}</b>
            {locked.size ? <em className="muted-line"> (🔒 сплачені — незмінні)</em> : null}
          </span>
          <div className="row-actions">
            <button className="btn" onClick={onCancel}>
              Скасувати
            </button>
            <button className="btn btn-primary" onClick={() => onSave([...chosen])}>
              Зберегти
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
