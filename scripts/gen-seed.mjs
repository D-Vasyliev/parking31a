// Генерує migrations/0002_seed_spots.sql з канонічних діапазонів секцій.
// Запуск: node scripts/gen-seed.mjs
// Єдине джерело правди діапазонів — src/shared/spot-ranges.json (його ж читає spots.ts).
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { ranges } = JSON.parse(readFileSync(join(root, "src", "shared", "spot-ranges.json"), "utf8"));

const rows = [];
for (const r of ranges) {
  for (let n = r.from; n <= r.to; n++) {
    rows.push(`  ('${n}', ${r.sheet}, '${r.section}', 'spot-${n}')`);
  }
}

const sql =
  `-- Міграція 0002 — сід машиномісць (${rows.length} шт., №1–181).\n` +
  `-- ЗГЕНЕРОВАНО scripts/gen-seed.mjs з src/shared/spot-ranges.json — не редагувати вручну.\n` +
  `INSERT INTO spots (number, sheet, section, svg_id) VALUES\n` +
  rows.join(",\n") +
  `;\n`;

writeFileSync(join(root, "migrations", "0002_seed_spots.sql"), sql, "utf8");
console.log(`OK: ${rows.length} місць → migrations/0002_seed_spots.sql`);
