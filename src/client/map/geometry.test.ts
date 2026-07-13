import { describe, it, expect } from "vitest";
import { layout } from "./geometry";
import { SPOTS } from "../../shared/spots";

describe("геометрія мапи", () => {
  it("рівні покривають рівно всі SPOTS", () => {
    const mapNums = new Set<number>();
    for (const lvl of ["F1", "F2"] as const) for (const s of layout(lvl).stalls) mapNums.add(s.n);
    expect(mapNums.size).toBe(SPOTS.length);
    for (const s of SPOTS) expect(mapNums.has(s.number)).toBe(true);
  });

  it("секція кожного місця збігається зі SPOTS", () => {
    const bySpot = new Map(SPOTS.map((s) => [s.number, s.section]));
    for (const lvl of ["F1", "F2"] as const) {
      for (const s of layout(lvl).stalls) expect(s.section).toBe(bySpot.get(s.n));
    }
  });
});
