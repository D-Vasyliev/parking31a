// Канонічний перелік машиномісць (181 шт.), звірено із замовником 09.07.2026.
// Єдине джерело правди діапазонів — spot-ranges.json (його ж читає scripts/gen-seed.mjs).

import rangesData from "./spot-ranges.json";

export type Section = "А" | "Б" | "В" | "Г";
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

/** Діапазони номерів по секціях (аркуш 1 = А/Б, аркуш 2 = В/Г). */
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
