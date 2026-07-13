import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { attachments, techArticles, projects, notes } from "../db/schema";
import { requireAuth } from "../middleware";
import { writeAudit } from "../lib/audit";
import { listAttachments } from "../lib/attachments";
import { MAX_ATTACHMENT_BYTES, type AttachmentEntityType } from "../../shared/api";

const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;
const ENTITY_TYPES: AttachmentEntityType[] = ["article", "project", "note"];
const ADMIN_ENTITIES = new Set<AttachmentEntityType>(["article", "project"]);

type DB = ReturnType<typeof createDb>;
async function entityExists(db: DB, type: AttachmentEntityType, id: number): Promise<boolean> {
  const t = type === "article" ? techArticles : type === "project" ? projects : notes;
  const row = (await db.select({ id: t.id }).from(t).where(eq(t.id, id)).limit(1))[0];
  return !!row;
}

export const filesRouter = new Hono<AppContext>();
filesRouter.use("*", requireAuth);

// Список файлів сутності: GET /?entityType=&entityId=
filesRouter.get("/", async (c) => {
  const type = c.req.query("entityType") as AttachmentEntityType;
  const id = Number(c.req.query("entityId"));
  if (!ENTITY_TYPES.includes(type) || !Number.isInteger(id)) return c.json({ error: { code: "bad_request", message: "Некоректні параметри" } }, 400);
  const db = createDb(c.env.DB);
  return c.json(await listAttachments(db, type, id));
});

// Завантаження: POST /?entityType=&entityId=&name=<url-encoded>, тіло = байти файлу.
filesRouter.post("/", async (c) => {
  const type = c.req.query("entityType") as AttachmentEntityType;
  const entityId = Number(c.req.query("entityId"));
  if (!ENTITY_TYPES.includes(type) || !Number.isInteger(entityId)) return c.json({ error: { code: "bad_request", message: "Некоректні параметри" } }, 400);
  const user = c.get("user")!;
  if (ADMIN_ENTITIES.has(type) && user.role !== "admin") return c.json({ error: { code: "forbidden", message: "Лише адміністратор" } }, 403);
  const db = createDb(c.env.DB);
  if (!(await entityExists(db, type, entityId))) return c.json({ error: { code: "not_found", message: "Обʼєкт не знайдено" } }, 404);

  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES) return c.json({ error: { code: "too_large", message: "Файл більший за 100 МБ" } }, 413);
  if (!c.req.raw.body) return c.json({ error: { code: "bad_request", message: "Порожнє тіло запиту" } }, 400);

  const filename = decodeURIComponent(c.req.query("name") ?? "file").replace(/[\r\n\\/]/g, "_").slice(0, 255) || "file";
  const contentType = c.req.header("Content-Type") || "application/octet-stream";
  const key = `att/${crypto.randomUUID()}`;

  const obj = await c.env.FILES.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  const size = obj?.size ?? declared;
  if (size > MAX_ATTACHMENT_BYTES) {
    await c.env.FILES.delete(key).catch(() => {});
    return c.json({ error: { code: "too_large", message: "Файл більший за 100 МБ" } }, 413);
  }

  const ins = await db
    .insert(attachments)
    .values({ entityType: type, entityId, filename, contentType, size, r2Key: key, uploadedBy: user.id })
    .returning({ id: attachments.id });
  await writeAudit(db, { userId: user.id, action: "attachment.create", entityType: "attachment", entityId: String(ins[0].id), payload: { for: `${type}:${entityId}`, filename, size }, ip: ip(c) });
  return c.json({ id: ins[0].id, filename, size }, 201);
});

// Вміст файлу: GET /:id/raw[?download=1]. PDF та растрові зображення — inline, решта — attachment.
filesRouter.get("/:id/raw", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const a = (await db.select().from(attachments).where(eq(attachments.id, id)).limit(1))[0];
  if (!a) return c.json({ error: { code: "not_found", message: "Файл не знайдено" } }, 404);
  const obj = await c.env.FILES.get(a.r2Key);
  if (!obj) return c.json({ error: { code: "not_found", message: "Файл відсутній у сховищі" } }, 404);

  const inlineOk = a.contentType === "application/pdf" || (a.contentType.startsWith("image/") && a.contentType !== "image/svg+xml");
  const disp = c.req.query("download") === "1" || !inlineOk ? "attachment" : "inline";
  const h = new Headers();
  h.set("Content-Type", a.contentType);
  h.set("Content-Length", String(a.size));
  h.set("Content-Disposition", `${disp}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  h.set("Cache-Control", "private, max-age=60");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers: h });
});

// Видалення: article/project → лише адмін; note → завантажувач або адмін.
filesRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const a = (await db.select().from(attachments).where(eq(attachments.id, id)).limit(1))[0];
  if (!a) return c.json({ error: { code: "not_found", message: "Файл не знайдено" } }, 404);
  const user = c.get("user")!;
  const isAdmin = user.role === "admin";
  const entityType = a.entityType as AttachmentEntityType;
  if (ADMIN_ENTITIES.has(entityType) ? !isAdmin : !isAdmin && a.uploadedBy !== user.id) {
    return c.json({ error: { code: "forbidden", message: "Немає прав на видалення" } }, 403);
  }
  await c.env.FILES.delete(a.r2Key).catch(() => {});
  await db.delete(attachments).where(eq(attachments.id, id));
  await writeAudit(db, { userId: user.id, action: "attachment.delete", entityType: "attachment", entityId: String(id), payload: { filename: a.filename }, ip: ip(c) });
  return c.json({ ok: true });
});
