import { useEffect, useMemo, useRef } from "react";
import { layout, type LevelKey } from "./geometry";
import type { SpotSummary } from "../../shared/api";

interface Props {
  level: LevelKey;
  occupancy: Map<number, SpotSummary>;
  selected: number | null;
  highlight: number | null;
  onSelect: (n: number) => void;
}

export function ParkingMap({ level, occupancy, selected, highlight, onSelect }: Props) {
  const lay = useMemo(() => layout(level), [level]);
  const targetN = highlight ?? selected;
  const targetRef = useRef<SVGGElement>(null);
  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [targetN, level]);

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
          const cls = [
            "pm-stall",
            occ?.occupied ? "occupied" : "free",
            selected === s.n ? "selected" : "",
            highlight === s.n ? "found" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const title = occ?.occupied ? `№${s.n} · ${occ.ownerName ?? ""}` : `№${s.n} · вільне`;
          return (
            <g
              key={s.n}
              ref={targetN === s.n ? targetRef : undefined}
              className={cls}
              transform={`translate(${s.x},${s.y})`}
              tabIndex={0}
              role="button"
              aria-label={title}
              onClick={() => onSelect(s.n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
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
            </g>
          );
        })}
      </svg>
    </div>
  );
}
