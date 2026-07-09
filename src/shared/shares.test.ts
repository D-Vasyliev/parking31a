import { describe, it, expect } from "vitest";
import { recalcShares, paymentStatus } from "./shares";

function mk(nums: number[]) {
  return nums.map((n) => ({ spotId: n * 10, number: n }));
}
function sum(rs: { shareKop: number }[]) {
  return rs.reduce((a, r) => a + r.shareKop, 0);
}

describe("recalcShares", () => {
  it("приклад SPEC: 12 345,67 грн ÷ 37 → 25×333,67 + 12×333,66", () => {
    const rs = recalcShares(1_234_567, mk(Array.from({ length: 37 }, (_, i) => i + 1)));
    expect(sum(rs)).toBe(1_234_567);
    const byNum = new Map(rs.map((r) => [r.spotId / 10, r.shareKop]));
    // місця 1..25 → 33367, 26..37 → 33366
    for (let n = 1; n <= 25; n++) expect(byNum.get(n)).toBe(33_367);
    for (let n = 26; n <= 37; n++) expect(byNum.get(n)).toBe(33_366);
  });

  it("сума завжди дорівнює total (різні комбінації)", () => {
    for (const [total, n] of [
      [100000, 7],
      [1, 3],
      [999, 1000],
      [500000, 48],
      [0, 5],
    ] as const) {
      const rs = recalcShares(total, mk(Array.from({ length: n }, (_, i) => i + 1)));
      expect(sum(rs)).toBe(total);
    }
  });

  it("total < n: залишок дає по 1 коп. найменшим номерам", () => {
    const rs = recalcShares(50, mk(Array.from({ length: 181 }, (_, i) => i + 1)));
    const byNum = new Map(rs.map((r) => [r.spotId / 10, r.shareKop]));
    for (let n = 1; n <= 50; n++) expect(byNum.get(n)).toBe(1);
    for (let n = 51; n <= 181; n++) expect(byNum.get(n)).toBe(0);
    expect(sum(rs)).toBe(50);
  });

  it("рівний поділ без залишку", () => {
    const rs = recalcShares(1000, mk([1, 2, 3, 4]));
    expect(rs.every((r) => r.shareKop === 250)).toBe(true);
  });

  it("детермінізм незалежно від порядку вводу", () => {
    const a = recalcShares(1_234_567, mk([5, 1, 3, 2, 4]));
    const b = recalcShares(1_234_567, mk([1, 2, 3, 4, 5]));
    const norm = (rs: { spotId: number; shareKop: number }[]) => rs.slice().sort((x, y) => x.spotId - y.spotId);
    expect(norm(a)).toEqual(norm(b));
  });

  it("порожній список", () => {
    expect(recalcShares(1000, [])).toEqual([]);
  });
});

describe("paymentStatus", () => {
  it("статуси за дельтою", () => {
    expect(paymentStatus(1000, 0, null)).toBe("unpaid");
    expect(paymentStatus(1000, 1000, "2026-07-09")).toBe("paid");
    expect(paymentStatus(1000, 1200, "2026-07-09")).toBe("overpaid");
    expect(paymentStatus(1000, 800, "2026-07-09")).toBe("underpaid");
  });
});
