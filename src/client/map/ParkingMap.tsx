import { useEffect, useMemo, useRef } from "react";
import { layout, type LevelKey } from "./geometry";
import type { SpotSummary } from "../../shared/api";

interface Props {
  level: LevelKey;
  occupancy: Map<number, SpotSummary>;
  selected: number | null;
  highlight: number | null;
  onSelect: (n: number) => void;
  // режим вибору (map-picker)
  picker?: boolean;
  chosen?: Set<number>;
  locked?: Set<number>;
}

export function ParkingMap({ level, occupancy, selected, highlight, onSelect, picker, chosen, locked }: Props) {
  const lay = useMemo(() => layout(level), [level]);
  const targetN = highlight ?? selected;
  const targetRef = useRef<SVGGElement>(null);
  useEffect(() => {
    if (!picker) targetRef.current?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [targetN, level, picker]);

  return (
    <div className="map-scroll">
      <svg className="parking-map" viewBox={`0 0 ${lay.vbW} ${lay.vbH}`} role="img" aria-label={`Схема, рівень ${level}`}>
        <rect className="pm-wall" x={lay.wall.x} y={lay.wall.y} width={lay.wall.w} height={lay.wall.h} rx={4} />
        {lay.roads.map((r, i) => (
          <rect key={`road-${i}`} className="pm-road" x={r.x} y={r.y} width={r.w} height={r.h} />
        ))}
        <rect className="pm-spine" x={lay.spine.x} y={lay.spine.y} width={lay.spine.w} height={lay.spine.h} />
        {lay.sectionLabels.map((l, i) => (
          <text key={`lbl-${i}`} className="pm-section" x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle">
            {l.text}
          </text>
        ))}
        {lay.stalls.map((s) => {
          const occ = occupancy.get(s.n);
          const isLocked = picker && locked?.has(s.n);
          const isChosen = picker && chosen?.has(s.n);
          const cls = picker
            ? ["pm-stall", isChosen ? "occupied" : "free", isLocked ? "locked" : ""].filter(Boolean).join(" ")
            : ["pm-stall", occ?.occupied ? "occupied" : "free", selected === s.n ? "selected" : "", highlight === s.n ? "found" : ""].filter(Boolean).join(" ");
          const title = picker ? `№${s.n}${isLocked ? " · сплачено" : ""}` : occ?.occupied ? `№${s.n} · ${occ.ownerName ?? ""}` : `№${s.n} · вільне`;
          const clickable = !isLocked;
          return (
            <g
              key={s.n}
              ref={targetN === s.n ? targetRef : undefined}
              className={cls}
              transform={`translate(${s.x},${s.y})`}
              tabIndex={clickable ? 0 : -1}
              role="button"
              aria-label={title}
              aria-pressed={picker ? !!isChosen : undefined}
              onClick={clickable ? () => onSelect(s.n) : undefined}
              onKeyDown={(e) => {
                if (clickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(s.n);
                }
              }}
            >
              <title>{title}</title>
              <rect x={0} y={0} width={s.w} height={s.h} rx={3} />
              <text x={s.w / 2} y={s.h / 2 + 1} textAnchor="middle" dominantBaseline="middle">
                {s.n}
              </text>
              {!picker && occ?.hasDebt ? <circle className="pm-debt" cx={s.w - 7} cy={7} r={4} /> : null}
              {isLocked ? <text className="pm-lock" x={s.w - 8} y={12}>🔒</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
