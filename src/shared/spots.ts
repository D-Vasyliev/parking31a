// Канонічний перелік машиномісць (181 шт.), звірено із замовником 09.07.2026.
// Єдине джерело правди для сіду БД та прив'язки до SVG-мапи.

export type Section = "А" | "Б" | "В" | "Г";
export type Sheet = 1 | 2;

export interface SpotDef {
  number: number;
  sheet: Sheet;
  section: Section;
  svgId: string;
}

/** Діапазони номерів по секціях (аркуш 1 = А/Б, аркуш 2 = В/Г). */
export const SECTION_RANGES: ReadonlyArray<{ from: number; to: number; sheet: Sheet; section: Section }> = [
  { from: 1, to: 44, sheet: 1, section: "Б" },
  { from: 45, to: 88, sheet: 1, section: "А" },
  { from: 89, to: 133, sheet: 2, section: "В" },
  { from: 134, to: 181, sheet: 2, section: "Г" },
];

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
