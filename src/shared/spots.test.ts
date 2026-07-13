import { describe, it, expect } from "vitest";
import { SPOTS, TOTAL_SPOTS, sectionOf } from "./spots";

describe("канонічний перелік місць", () => {
  it("181 суцільне місце №1..181", () => {
    expect(TOTAL_SPOTS).toBe(181);
    const nums = SPOTS.map((s) => s.number).sort((a, b) => a - b);
    expect(nums[0]).toBe(1);
    expect(nums[nums.length - 1]).toBe(181);
    for (let i = 0; i < nums.length; i++) expect(nums[i]).toBe(i + 1);
  });

  it("унікальні svg_id", () => {
    const ids = new Set(SPOTS.map((s) => s.svgId));
    expect(ids.size).toBe(TOTAL_SPOTS);
  });

  it("межі секцій: Б=44, А=44, В=45, Г=48", () => {
    const count = (sec: string) => SPOTS.filter((s) => s.section === sec).length;
    expect(count("1")).toBe(43);
    expect(count("2")).toBe(46);
    expect(count("3")).toBe(44);
    expect(count("4")).toBe(48);
    expect(sectionOf(1)).toBe("1");
    expect(sectionOf(43)).toBe("1");
    expect(sectionOf(44)).toBe("2");
    expect(sectionOf(89)).toBe("2");
    expect(sectionOf(90)).toBe("3");
    expect(sectionOf(133)).toBe("3");
    expect(sectionOf(134)).toBe("4");
    expect(sectionOf(181)).toBe("4");
    expect(sectionOf(999)).toBeNull();
  });

  it("поверхи: №1–89 → 1, №90–181 → 2", () => {
    for (const s of SPOTS) {
      expect(s.sheet).toBe(s.number <= 89 ? 1 : 2);
    }
  });
});
