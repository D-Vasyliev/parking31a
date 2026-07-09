// Детермінований поділ вартості проєкту на місця-учасники (SPEC §2.3).
// Гроші — цілі копійки. Залишок від ділення розподіляється по +1 коп.
// на місця з найменшими номерами (числове сортування).

export interface ShareInput {
  spotId: number;
  number: number;
}
export interface ShareResult {
  spotId: number;
  shareKop: number;
}

export function recalcShares(totalKop: number, spots: ShareInput[]): ShareResult[] {
  const sorted = [...spots].sort((a, b) => a.number - b.number);
  const n = sorted.length;
  if (n === 0) return [];
  const base = Math.floor(totalKop / n);
  const remainder = totalKop - base * n; // 0 ≤ remainder < n
  return sorted.map((s, i) => ({ spotId: s.spotId, shareKop: base + (i < remainder ? 1 : 0) }));
}

/** Дельта оплати: >0 переплата, <0 доплата, =0 рівно, null — не сплачено. */
export function paymentStatus(shareKop: number, paidKop: number, paidAt: string | null): "unpaid" | "paid" | "overpaid" | "underpaid" {
  if (!paidAt) return "unpaid";
  const delta = paidKop - shareKop;
  if (delta === 0) return "paid";
  return delta > 0 ? "overpaid" : "underpaid";
}
