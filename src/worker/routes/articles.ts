import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { techArticles, users } from "../db/schema";
import { requireAuth, requireAdmin } from "../middleware";
import { writeAudit } from "../lib/audit";
import { deleteAttachmentsFor } from "../lib/attachments";
import type { ArticleView } from "../../shared/api";

const iso = () => new Date().toISOString();
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;

export const articlesRouter = new Hono<AppContext>();
articlesRouter.use("*", requireAuth);

// Список статей (усі авторизовані)
articlesRouter.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      id: techArticles.id,
      title: techArticles.title,
      body: techArticles.body,
      createdAt: techArticles.createdAt,
      updatedAt: techArticles.updatedAt,
      email: users.email,
    })
    .from(techArticles)
    .leftJoin(users, eq(users.id, techArticles.updatedBy))
    .orderBy(desc(techArticles.updatedAt), desc(techArticles.id));
  return c.json(rows.map((r): ArticleView => ({ id: r.id, title: r.title, body: r.body, createdAt: r.createdAt, updatedAt: r.updatedAt, updatedByEmail: r.email })));
});

// Запис (створення/редагування/видалення) — лише адміністратори (гейт на кожному маршруті).
const saveSchema = z.object({
  title: z.string().trim().min(1, "Потрібен заголовок").max(200),
  body: z.string().max(20000).nullish(),
});

async function parse(c: { req: { json: () => Promise<unknown> } }) {
  try {
    const r = saveSchema.safeParse(await c.req.json());
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

articlesRouter.post("/", requireAdmin, async (c) => {
  const body = await parse(c);
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  const db = createDb(c.env.DB);
  const uid = c.get("user")!.id;
  const now = iso();
  const ins = await db
    .insert(techArticles)
    .values({ title: body.title, body: body.body ?? "", createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now })
    .returning({ id: techArticles.id });
  await writeAudit(db, { userId: uid, action: "article.create", entityType: "article", entityId: String(ins[0].id), payload: { title: body.title }, ip: ip(c) });
  return c.json({ id: ins[0].id }, 201);
});

articlesRouter.patch("/:id", requireAdmin, async (c) => {
  const body = await parse(c);
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const uid = c.get("user")!.id;
  const r = await db
    .update(techArticles)
    .set({ title: body.title, body: body.body ?? "", updatedBy: uid, updatedAt: iso() })
    .where(eq(techArticles.id, id))
    .returning({ id: techArticles.id });
  if (!r.length) return c.json({ error: { code: "not_found", message: "Статтю не знайдено" } }, 404);
  await writeAudit(db, { userId: uid, action: "article.update", entityType: "article", entityId: String(id), payload: { title: body.title }, ip: ip(c) });
  return c.json({ ok: true });
});

articlesRouter.delete("/:id", requireAdmin, async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const r = await db.delete(techArticles).where(eq(techArticles.id, id)).returning({ id: techArticles.id });
  if (!r.length) return c.json({ error: { code: "not_found", message: "Статтю не знайдено" } }, 404);
  await deleteAttachmentsFor(c.env, db, "article", id);
  await writeAudit(db, { userId: c.get("user")!.id, action: "article.delete", entityType: "article", entityId: String(id), payload: null, ip: ip(c) });
  return c.json({ ok: true });
});
