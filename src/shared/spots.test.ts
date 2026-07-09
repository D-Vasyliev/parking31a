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
    expect(count("Б")).toBe(44);
    expect(count("А")).toBe(44);
    expect(count("В")).toBe(45);
    expect(count("Г")).toBe(48);
    expect(sectionOf(1)).toBe("Б");
    expect(sectionOf(44)).toBe("Б");
    expect(sectionOf(45)).toBe("А");
    expect(sectionOf(88)).toBe("А");
    expect(sectionOf(89)).toBe("В");
    expect(sectionOf(133)).toBe("В");
    expect(sectionOf(134)).toBe("Г");
    expect(sectionOf(181)).toBe("Г");
    expect(sectionOf(999)).toBeNull();
  });

  it("аркуші: №1–88 → 1, №89–181 → 2", () => {
    for (const s of SPOTS) {
      expect(s.sheet).toBe(s.number <= 88 ? 1 : 2);
    }
  });
});
