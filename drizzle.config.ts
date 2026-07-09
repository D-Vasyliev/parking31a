import { defineConfig } from "drizzle-kit";

// Гібридний workflow: схема у TS → drizzle-kit генерує SQL у ./migrations,
// які застосовує `wrangler d1 migrations apply`.
export default defineConfig({
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
