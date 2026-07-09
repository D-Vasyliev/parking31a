/** ISO/SQLite дата → dd.mm.yyyy (за датою; час-зона на рівні дня неістотна). */
export function formatDate(s: string | null | undefined): string {
  if (!s) return "";
  const [y, m, d] = s.slice(0, 10).split("-");
  return d && m && y ? `${d}.${m}.${y}` : s;
}

/** Копійки → «12 345,67 грн». */
export function formatKop(kop: number): string {
  const neg = kop < 0;
  const a = Math.abs(kop);
  const grn = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${grn},${String(a % 100).padStart(2, "0")} грн`;
}

/** «12 345,67» / «12345.67» → копійки; null, якщо ввід некоректний (замість тихого 0). */
export function parseKop(v: string): number | null {
  const cleaned = v.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
