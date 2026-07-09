import { defineConfig } from "drizzle-kit";

// УВАГА: джерело правди для схеми БД — SQL-міграції у ./migrations (написані вручну,
// щоб точно відтворити CHECK-обмеження, часткові унікальні індекси та COLLATE NOCASE,
// які drizzle-kit не завжди генерує коректно).
//
// НЕ запускати `drizzle-kit generate` — src/worker/db/schema.ts є лише типовим
// дзеркалом і не кодує усіх DB-рівневих гарантій; генерація перезаписала б їх.
// Цей конфіг лишено тільки для `drizzle-kit studio` (перегляд БД) та інтроспекції.
export default defineConfig({
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
