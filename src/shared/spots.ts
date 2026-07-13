// Канонічний перелік машиномісць (181 шт.), звірено із замовником 13.07.2026 за фото схеми.
// Поверх 1 (sheet 1): секція 1 = №1–43, секція 2 = №44–89.
// Поверх 2 (sheet 2): секція 3 = №90–133, секція 4 = №134–181.
// Єдине джерело правди діапазонів — spot-ranges.json.

import rangesData from "./spot-ranges.json";

export type Section = "1" | "2" | "3" | "4";
export type Sheet = 1 | 2;

export interface SectionRange {
  from: number;
  to: number;
  sheet: Sheet;
  section: Section;
}

export interface SpotDef {
  number: number;
  sheet: Sheet;
  section: Section;
  svgId: string;
}

/** Діапазони номерів по секціях (поверх 1 = секції 1/2, поверх 2 = секції 3/4). */
export const SECTION_RANGES = rangesData.ranges as readonly SectionRange[];

export const SPOTS: SpotDef[] = SECTION_RANGES.flatMap((r) => {
  const out: SpotDef[] = [];
  for (let n = r.from; n <= r.to; n++) {
    out.push({ number: n, sheet: r.sheet, section: r.section, svgId: `spot-${n}` });
  }
  return out;
});

export const TOTAL_SPOTS = SPOTS.length; // 181

export function sectionOf(spotNumber: number): Section | null {
  const r = SECTION_RANGES.find((x) => spotNumber >= x.from && spotNumber <= x.to);
  return r ? r.section : null;
}
