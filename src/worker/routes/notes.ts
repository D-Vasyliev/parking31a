import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { notes } from "../db/schema";
import { requireAuth } from "../middleware";
import { writeAudit } from "../lib/audit";
import { deleteAttachmentsFor } from "../lib/attachments";

const nowIso = () => new Date().toISOString();
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;

export const notesRouter = new Hono<AppContext>();
notesRouter.use("*", requireAuth);

// Редагувати ручну нотатку (авто-нотатки проєктів незмінні)
notesRouter.patch("/:id", async (c) => {
  let body: { body: string } | null = null;
  try {
    const parsed = z.object({ body: z.string().min(1).max(20000) }).safeParse(await c.req.json());
    if (parsed.success) body = parsed.data;
  } catch {
    body = null;
  }
  if (!body) return c.json({ error: { code: "bad_request", message: "Порожня нотатка" } }, 400);
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const note = (await db.select().from(notes).where(eq(notes.id, id)).limit(1))[0];
  if (!note) return c.json({ error: { code: "not_found", message: "Нотатку не знайдено" } }, 404);
  if (note.kind !== "manual") return c.json({ error: { code: "immutable", message: "Авто-нотатку не можна редагувати" } }, 409);
  await db.update(notes).set({ body: body.body, updatedAt: nowIso() }).where(eq(notes.id, id));
  await writeAudit(db, { userId: c.get("user")!.id, action: "note.update", entityType: "note", entityId: String(id), ip: ip(c) });
  return c.json({ ok: true });
});

// Видалити ручну нотатку
notesRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const note = (await db.select().from(notes).where(eq(notes.id, id)).limit(1))[0];
  if (!note) return c.json({ error: { code: "not_found", message: "Нотатку не знайдено" } }, 404);
  if (note.kind !== "manual") return c.json({ error: { code: "immutable", message: "Авто-нотатку не можна видалити" } }, 409);
  await db.delete(notes).where(and(eq(notes.id, id), eq(notes.kind, "manual")));
  await deleteAttachmentsFor(c.env, db, "note", id);
  await writeAudit(db, { userId: c.get("user")!.id, action: "note.delete", entityType: "note", entityId: String(id), ip: ip(c) });
  return c.json({ ok: true });
});
