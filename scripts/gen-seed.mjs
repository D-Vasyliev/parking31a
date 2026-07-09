// Генерує migrations/0002_seed_spots.sql з канонічних діапазонів секцій.
// Запуск: node scripts/gen-seed.mjs
// Діапазони мають збігатися з src/shared/spots.ts (SECTION_RANGES).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RANGES = [
  { from: 1, to: 44, sheet: 1, section: "Б" },
  { from: 45, to: 88, sheet: 1, section: "А" },
  { from: 89, to: 133, sheet: 2, section: "В" },
  { from: 134, to: 181, sheet: 2, section: "Г" },
];

const rows = [];
for (const r of RANGES) {
  for (let n = r.from; n <= r.to; n++) {
    rows.push(`  ('${n}', ${r.sheet}, '${r.section}', 'spot-${n}')`);
  }
}

const sql =
  `-- Міграція 0002 — сід машиномісць (${rows.length} шт., №1–181).\n` +
  `-- ЗГЕНЕРОВАНО scripts/gen-seed.mjs — не редагувати вручну.\n` +
  `INSERT INTO spots (number, sheet, section, svg_id) VALUES\n` +
  rows.join(",\n") +
  `;\n`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "migrations", "0002_seed_spots.sql");
writeFileSync(outPath, sql, "utf8");
console.log(`OK: ${rows.length} місць → ${outPath}`);
