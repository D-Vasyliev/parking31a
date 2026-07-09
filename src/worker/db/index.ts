import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** Створює типізований Drizzle-клієнт поверх прив'язки D1. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type DB = ReturnType<typeof createDb>;
export { schema };
