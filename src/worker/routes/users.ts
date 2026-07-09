import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { users, recoveryCodes } from "../db/schema";
import { requireAuth, requireAdmin } from "../middleware";
import { hashPassword, generateTempPassword } from "../auth/password";
import { destroyAllSessions } from "../auth/session";
import { writeAudit, auditIns } from "../lib/audit";
import type { UserView, TempPasswordResult } from "../../shared/api";

const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;

export const usersRouter = new Hono<AppContext>();
usersRouter.use("*", requireAuth);
usersRouter.use("*", requireAdmin);

usersRouter.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(users).orderBy(asc(users.email));
  return c.json(
    rows.map(
      (u): UserView => ({ id: u.id, email: u.email, role: u.role, isActive: u.isActive === 1, totpEnabled: u.totpEnabled === 1, mustChangePw: u.mustChangePw === 1, createdAt: u.createdAt }),
    ),
  );
});

usersRouter.post("/", async (c) => {
  let email = "";
  try {
    const p = z.object({ email: z.string().max(320).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/) }).safeParse(await c.req.json());
    if (!p.success) return c.json({ error: { code: "bad_request", message: "Вкажіть коректний email" } }, 400);
    email = p.data.email.trim().toLowerCase();
  } catch {
    return c.json({ error: { code: "bad_request", message: "Вкажіть email" } }, 400);
  }
  const db = createDb(c.env.DB);
  const exists = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0];
  if (exists) return c.json({ error: { code: "duplicate", message: "Користувач з таким email вже існує" } }, 409);
  const tempPassword = generateTempPassword();
  const ins = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(tempPassword), role: "admin", mustChangePw: 1, isActive: 1 })
    .returning({ id: users.id });
  await writeAudit(db, { userId: c.get("user")!.id, action: "user.create", entityType: "user", entityId: String(ins[0].id), payload: { email }, ip: ip(c) });
  return c.json({ email, tempPassword } satisfies TempPasswordResult, 201);
});

// Скидання пароля + 2ФА (новий тимчасовий пароль, повторний enrollment)
usersRouter.post("/:id/reset-password", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: { code: "bad_request", message: "Некоректний id" } }, 400);
  const u = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!u) return c.json({ error: { code: "not_found", message: "Користувача не знайдено" } }, 404);
  const tempPassword = generateTempPassword();
  await db.batch([
    db.update(users).set({ passwordHash: await hashPassword(tempPassword), mustChangePw: 1, totpEnabled: 0, totpSecret: null, lastTotpStep: null, failedLogins: 0, lockedUntil: null }).where(eq(users.id, id)),
    db.delete(recoveryCodes).where(eq(recoveryCodes.userId, id)),
    auditIns(db, { userId: c.get("user")!.id, action: "user.reset", entityType: "user", entityId: String(id), ip: ip(c) }),
  ]);
  await destroyAllSessions(db, id);
  return c.json({ email: u.email, tempPassword } satisfies TempPasswordResult);
});

usersRouter.post("/:id/active", async (c) => {
  let active = true;
  try {
    const p = z.object({ active: z.boolean() }).safeParse(await c.req.json());
    if (!p.success) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
    active = p.data.active;
  } catch {
    return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  }
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: { code: "bad_request", message: "Некоректний id" } }, 400);
  if (!active && id === c.get("user")!.id) return c.json({ error: { code: "self", message: "Не можна деактивувати себе" } }, 409);
  const u = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!u) return c.json({ error: { code: "not_found", message: "Користувача не знайдено" } }, 404);
  if (active) {
    await db.update(users).set({ isActive: 1 }).where(eq(users.id, id));
  } else {
    // Атомарний гвард останнього активного адміна (проти гонки взаємної деактивації).
    const upd = await db
      .update(users)
      .set({ isActive: 0 })
      .where(and(eq(users.id, id), sql`(SELECT count(*) FROM users WHERE is_active = 1 AND role = 'admin' AND id <> ${id}) >= 1`))
      .returning({ id: users.id });
    if (!upd.length) return c.json({ error: { code: "last_admin", message: "Не можна деактивувати останнього активного адміністратора" } }, 409);
    await destroyAllSessions(db, id);
  }
  await writeAudit(db, { userId: c.get("user")!.id, action: active ? "user.update" : "user.disable", entityType: "user", entityId: String(id), payload: { active }, ip: ip(c) });
  return c.json({ ok: true });
});
