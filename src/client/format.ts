/** ISO/SQLite дата → dd.mm.yyyy (за датою; час-зона на рівні дня неістотна). */
export function formatDate(s: string | null | undefined): string {
  if (!s) return "";
  const [y, m, d] = s.slice(0, 10).split("-");
  return d && m && y ? `${d}.${m}.${y}` : s;
}
