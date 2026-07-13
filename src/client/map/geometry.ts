// Геометрія схеми паркінгу (порт із reference/parking-scheme.html) → дані для React-SVG.
import type { Section } from "../../shared/spots";

export type LevelKey = "F1" | "F2";

export interface Stall {
  n: number;
  section: Section;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Label {
  x: number;
  y: number;
  text: string;
}
export interface LevelLayout {
  vbW: number;
  vbH: number;
  wall: Rect;
  roads: Rect[];
  spine: Rect;
  stalls: Stall[];
  sectionLabels: Label[];
}

const SW = 42;
const SH = 74;
const LEFT = 156;
const R1 = 49;
const R3 = 195;
const R5 = 279;
const R7 = 425;
const A1 = 123;
const A1H = 72;
const A2 = 353;
const A2H = 72;
const SPINE_H = 10;
const VBH = 560;

interface RowCfg {
  y: number;
  from: number;
  to: number;
  section: Section;
}

// Розташування як на схемі замовника: угорі — старша секція, знизу — молодша.
// Поверх 1: зверху секція 2 (№44–89), знизу секція 1 (№1–43).
// Поверх 2: зверху секція 4 (№134–181), знизу секція 3 (№90–133).
// У кожній секції перше (менше) місце — у верхньому рядку (R1/R5), більші — нижче (R3/R7).
const LEVELS: Record<LevelKey, RowCfg[]> = {
  F1: [
    { y: R1, from: 44, to: 69, section: "2" },
    { y: R3, from: 70, to: 89, section: "2" },
    { y: R5, from: 1, to: 20, section: "1" },
    { y: R7, from: 21, to: 43, section: "1" },
  ],
  F2: [
    { y: R1, from: 134, to: 160, section: "4" },
    { y: R3, from: 161, to: 181, section: "4" },
    { y: R5, from: 90, to: 110, section: "3" },
    { y: R7, from: 111, to: 133, section: "3" },
  ],
};

export const LEVEL_META: Record<LevelKey, { title: string; range: string }> = {
  F1: { title: "Поверх 1", range: "секції 1–2 · №1–89" },
  F2: { title: "Поверх 2", range: "секції 3–4 · №90–181" },
};

export function layout(level: LevelKey): LevelLayout {
  const rows = LEVELS[level];
  const stalls: Stall[] = [];
  let maxCount = 0;
  for (const r of rows) {
    const n = r.to - r.from + 1;
    if (n > maxCount) maxCount = n;
    for (let i = 0; i < n; i++) {
      stalls.push({ n: r.from + i, section: r.section, x: LEFT + i * SW, y: r.y, w: SW, h: SH });
    }
  }
  const rowRight = LEFT + maxCount * SW;
  const islandCount = Math.max(rows[1].to - rows[1].from + 1, rows[2].to - rows[2].from + 1);
  const islandRight = LEFT + islandCount * SW;
  const roadLeft = LEFT - 66;
  const roadRight = rowRight + 24;
  const vbW = Math.max(1300, roadRight + 56);

  const roads: Rect[] = [
    { x: roadLeft, y: A1, w: roadRight - roadLeft, h: A1H },
    { x: roadLeft, y: A2, w: roadRight - roadLeft, h: A2H },
    { x: roadLeft, y: A1, w: 60, h: A2 + A2H - A1 },
    { x: roadRight - 60, y: A1, w: 60, h: A2 + A2H - A1 },
  ];
  const spine: Rect = { x: LEFT, y: R3 + SH, w: islandRight - LEFT, h: SPINE_H };
  const wall: Rect = { x: 6, y: 34, w: vbW - 12, h: R7 + SH + 18 - 34 };
  const ox = islandRight + (roadRight - islandRight) / 2;
  const sectionLabels: Label[] = [
    { x: ox, y: R3 + SH / 2, text: `Секція ${rows[1].section}` },
    { x: ox, y: R5 + SH / 2, text: `Секція ${rows[2].section}` },
  ];

  return { vbW, vbH: VBH, wall, roads, spine, stalls, sectionLabels };
}
