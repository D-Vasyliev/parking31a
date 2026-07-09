import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb, type DB } from "../db";
import { projects, projectSpots, spots, spotOwners, owners, notes } from "../db/schema";
import { requireAuth } from "../middleware";
import { writeAudit } from "../lib/audit";
import { recalcShares, paymentStatus } from "../../shared/shares";
import type { Section } from "../../shared/spots";
import type { ProjectListItem, ProjectDetail, ProjectParticipant, PaymentMethod } from "../../shared/api";

const iso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;
const NOT_FOUND = { error: { code: "not_found", message: "Проєкт не знайдено" } } as const;

function fmtKop(kop: number): string {
  const neg = kop < 0;
  const a = Math.abs(kop);
  const grn = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${grn},${String(a % 100).padStart(2, "0")}`;
}
function fmtDateUa(s: string): string {
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

async function parse<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const r = schema.safeParse(await c.req.json());
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

async function getProject(db: DB, id: number) {
  if (!Number.isInteger(id)) return undefined;
  return (await db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
}

/** Перерахувати частки всім поточним учасникам проєкту (атомарно). */
async function recalcAndPersist(db: DB, projectId: number, totalKop: number) {
  const parts = await db
    .select({ spotId: projectSpots.spotId, number: spots.number })
    .from(projectSpots)
    .innerJoin(spots, eq(spots.id, projectSpots.spotId))
    .where(eq(projectSpots.projectId, projectId));
  const shares = recalcShares(totalKop, parts.map((p) => ({ spotId: p.spotId, number: Number(p.number) })));
  if (shares.length === 0) return;
  const stmts = shares.map((s) =>
    db.update(projectSpots).set({ shareKop: s.shareKop }).where(and(eq(projectSpots.projectId, projectId), eq(projectSpots.spotId, s.spotId))),
  );
  await db.batch([stmts[0], ...stmts.slice(1)]);
}

async function buildDetail(db: DB, p: typeof projects.$inferSelect): Promise<ProjectDetail> {
  const rows = await db
    .select({
      spotId: projectSpots.spotId,
      number: spots.number,
      section: spots.section,
      shareKop: projectSpots.shareKop,
      paidKop: projectSpots.paidKop,
      paidAt: projectSpots.paidAt,
      method: projectSpots.paymentMethod,
      note: projectSpots.paymentNote,
      ownerName: owners.fullName,
    })
    .from(projectSpots)
    .innerJoin(spots, eq(spots.id, projectSpots.spotId))
    .leftJoin(spotOwners, and(eq(spotOwners.spotId, spots.id), isNull(spotOwners.endedAt), eq(spotOwners.isPrimary, 1)))
    .leftJoin(owners, eq(owners.id, spotOwners.ownerId))
    .where(eq(projectSpots.projectId, p.id))
    .orderBy(asc(spots.id));

  let collected = 0;
  const participants: ProjectParticipant[] = rows.map((r) => {
    collected += r.paidKop;
    return {
      spotId: r.spotId,
      number: Number(r.number),
      section: r.section as Section,
      ownerName: r.ownerName,
      shareKop: r.shareKop,
      paidKop: r.paidKop,
      paidAt: r.paidAt,
      paymentMethod: r.method as PaymentMethod | null,
      paymentNote: r.note,
      status: paymentStatus(r.shareKop, r.paidKop, r.paidAt),
      delta: r.paidKop - r.shareKop,
    };
  });

  return {
    id: p.id,
    title: p.title,
    description: p.description,
    status: p.status,
    cancelled: p.cancelled === 1,
    totalKop: p.totalKop,
    createdAt: p.createdAt,
    activatedAt: p.activatedAt,
    completedAt: p.completedAt,
    archivedAt: p.archivedAt,
    collectedKop: collected,
    participants,
  };
}

export const projectsRouter = new Hono<AppContext>();
projectsRouter.use("*", requireAuth);

// Список
projectsRouter.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const projs = await db
    .select()
    .from(projects)
    .orderBy(sql`case ${projects.status} when 'active' then 0 when 'draft' then 1 when 'completed' then 2 else 3 end`, desc(projects.id));
  const agg = await db
    .select({
      pid: projectSpots.projectId,
      cnt: sql<number>`count(*)`,
      paid: sql<number>`sum(case when ${projectSpots.paidAt} is not null then 1 else 0 end)`,
      collected: sql<number>`coalesce(sum(${projectSpots.paidKop}),0)`,
    })
    .from(projectSpots)
    .groupBy(projectSpots.projectId);
  const byId = new Map(agg.map((a) => [a.pid, a]));
  return c.json(
    projs.map((p): ProjectListItem => {
      const a = byId.get(p.id);
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        cancelled: p.cancelled === 1,
        totalKop: p.totalKop,
        spotCount: Number(a?.cnt ?? 0),
        paidCount: Number(a?.paid ?? 0),
        collectedKop: Number(a?.collected ?? 0),
      };
    }),
  );
});

// Створити (чернетка)
projectsRouter.post("/", async (c) => {
  const body = await parse(c, z.object({ title: z.string().min(1).max(200), description: z.string().max(2000).nullish(), totalKop: z.number().int().min(0) }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Вкажіть назву і вартість" } }, 400);
  const db = createDb(c.env.DB);
  const ins = await db
    .insert(projects)
    .values({ title: body.title, description: body.description ?? null, totalKop: body.totalKop, status: "draft", createdBy: c.get("user")!.id })
    .returning({ id: projects.id });
  await writeAudit(db, { userId: c.get("user")!.id, action: "project.create", entityType: "project", entityId: String(ins[0].id), payload: { title: body.title }, ip: ip(c) });
  const p = await getProject(db, ins[0].id);
  return c.json(await buildDetail(db, p!), 201);
});

projectsRouter.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const p = await getProject(db, Number(c.req.param("id")));
  if (!p) return c.json(NOT_FOUND, 404);
  return c.json(await buildDetail(db, p));
});

// Редагувати (draft/active); зміна суми → перерахунок
projectsRouter.patch("/:id", async (c) => {
  const body = await parse(c, z.object({ title: z.string().min(1).max(200).optional(), description: z.string().max(2000).nullish(), totalKop: z.number().int().min(0).optional() }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  const db = createDb(c.env.DB);
  const p = await getProject(db, Number(c.req.param("id")));
  if (!p) return c.json(NOT_FOUND, 404);
  if (p.status !== "draft" && p.status !== "active") return c.json({ error: { code: "readonly", message: "Проєкт лише для читання" } }, 409);
  const set: Partial<{ title: string; description: string | null; totalKop: number }> = {};
  if (body.title !== undefined) set.title = body.title;
  if (body.description !== undefined) set.description = body.description ?? null;
  if (body.totalKop !== undefined) set.totalKop = body.totalKop;
  if (Object.keys(set).length) await db.update(projects).set(set).where(eq(projects.id, p.id));
  if (body.totalKop !== undefined) await recalcAndPersist(db, p.id, body.totalKop);
  await writeAudit(db, { userId: c.get("user")!.id, action: "project.update", entityType: "project", entityId: String(p.id), payload: set, ip: ip(c) });
  const fresh = await getProject(db, p.id);
  return c.json(await buildDetail(db, fresh!));
});

// Видалити (лише чернетка)
projectsRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const p = await getProject(db, Number(c.req.param("id")));
  if (!p) return c.json(NOT_FOUND, 404);
  if (p.status !== "draft") return c.json({ error: { code: "not_draft", message: "Видалити можна лише чернетку" } }, 409);
  await db.delete(projects).where(eq(projects.id, p.id)); // project_spots каскадом
  await writeAudit(db, { userId: c.get("user")!.id, action: "project.delete", entityType: "project", entityId: String(p.id), ip: ip(c) });
  return c.json({ ok: true });
});

// Задати повний набір учасників (draft/active) з перерахунком
projectsRouter.put("/:id/spots", async (c) => {
  const body = await parse(c, z.object({ numbers: z.array(z.number().int()).max(400) }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректний список місць" } }, 400);
  const db = createDb(c.env.DB);
  const p = await getProject(db, Number(c.req.param("id")));
  if (!p) return c.json(NOT_FOUND, 404);
  if (p.status !== "draft" && p.status !== "active") return c.json({ error: { code: "readonly", message: "Склад можна змінювати лише у чернетці/активному" } }, 409);

  const wanted = await db.select({ id: spots.id, number: spots.number }).from(spots).where(inArray(spots.number, body.numbers.map(String)));
  const wantedIds = new Set(wanted.map((s) => s.id));
  const current = await db.select({ spotId: projectSpots.spotId, paidAt: projectSpots.paidAt }).from(projectSpots).where(eq(projectSpots.projectId, p.id));
  const currentIds = new Set(current.map((r) => r.spotId));

  const toRemove = current.filter((r) => !wantedIds.has(r.spotId));
  const paidRemoval = toRemove.find((r) => r.paidAt != null);
  if (paidRemoval) return c.json({ error: { code: "paid_spot", message: "Спершу скасуйте оплату місця, перш ніж вилучати його" } }, 409);

  const removeIds = toRemove.map((r) => r.spotId);
  const addIds = wanted.filter((s) => !currentIds.has(s.id)).map((s) => s.id);
  const ops = [];
  if (removeIds.length) ops.push(db.delete(projectSpots).where(and(eq(projectSpots.projectId, p.id), inArray(projectSpots.spotId, removeIds))));
  for (const id of addIds) ops.push(db.insert(projectSpots).values({ projectId: p.id, spotId: id, shareKop: 0 }));
  if (ops.length) await db.batch([ops[0], ...ops.slice(1)]);
  await recalcAndPersist(db, p.id, p.totalKop);
  await writeAudit(db, { userId: c.get("user")!.id, action: "project.spots_set", entityType: "project", entityId: String(p.id), payload: { added: addIds.length, removed: removeIds.length }, ip: ip(c) });
  const fresh = await getProject(db, p.id);
  return c.json(await buildDetail(db, fresh!));
});

// Позначити оплату (bulk): paid_kop = share_kop
projectsRouter.post("/:id/payments", async (c) => {
  const body = await parse(
    c,
    z.object({ numbers: z.array(z.number().int()).min(1).max(400), paymentMethod: z.enum(["cash", "transfer", "other"]).optional(), paymentNote: z.string().max(500).nullish(), paidAt: z.string().max(30).optional() }),
  );
  if (!body) return c.json({ error: { code: "bad_request", message: "Оберіть місця" } }, 400);
  const db = createDb(c.env.DB);
  const p = await getProject(db, Number(c.req.param("id")));
  if (!p) return c.json(NOT_FOUND, 404);
  if (p.status !== "active") return c.json({ error: { code: "not_active", message: "Оплати відмічають лише в активному проєкті" } }, 409);
  const paidAt = body.paidAt && /^\d{4}-\d{2}-\d{2}/.test(body.paidAt) ? body.paidAt.slice(0, 10) : today();
  const wanted = await db.select({ id: spots.id }).from(spots).where(inArray(spots.number, body.numbers.map(String)));
  const rows = await db.select().from(projectSpots).where(and(eq(projectSpots.projectId, p.id), inArray(projectSpots.spotId, wanted.map((s) => s.id))));
  if (rows.length === 0) return c.json({ error: { code: "not_participant", message: "Місця не є учасниками проєкту" } }, 400);
  const stmts = rows.map((r) =>
    db
      .update(projectSpots)
      .set({ paidKop: r.shareKop, paidAt, paidMarkedBy: c.get("user")!.id, paymentMethod: body.paymentMethod ?? null, paymentNote: body.paymentNote ?? null })
      .where(and(eq(projectSpots.projectId, p.id), eq(projectSpots.spotId, r.spotId))),
  );
  await db.batch([stmts[0], ...stmts.slice(1)]);
  await writeAudit(db, { userId: c.get("user")!.id, action: "payment.mark", entityType: "project", entityId: String(p.id), payload: { count: rows.length, paidAt }, ip: ip(c) });
  const fresh = await getProject(db, p.id);
  return c.json(await buildDetail(db, fresh!));
});

// Скасувати оплату (з причиною)
projectsRouter.post("/:id/payments/cancel", async (c) => {
  const body = await parse(c, z.object({ number: z.number().int(), reason: z.string().min(1).max(500) }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Вкажіть причину скасування" } }, 400);
  const db = createDb(c.env.DB);
  const p = await getProject(db, Number(c.req.param("id")));
  if (!p) return c.json(NOT_FOUND, 404);
  if (p.status !== "active") return c.json({ error: { code: "not_active", message: "Скасувати оплату можна лише в активному проєкті" } }, 409);
  const spot = (await db.select({ id: spots.id }).from(spots).where(eq(spots.number, String(body.number))).limit(1))[0];
  if (!spot) return c.json({ error: { code: "not_found", message: "Місце не знайдено" } }, 404);
  const ps = (await db.select().from(projectSpots).where(and(eq(projectSpots.projectId, p.id), eq(projectSpots.spotId, spot.id))).limit(1))[0];
  if (!ps || ps.paidAt == null) return c.json({ error: { code: "not_paid", message: "Оплату не зафіксовано" } }, 409);
  await db.batch([
    db.update(projectSpots).set({ paidKop: 0, paidAt: null, paidMarkedBy: null, paymentMethod: null, paymentNote: null }).where(and(eq(projectSpots.projectId, p.id), eq(projectSpots.spotId, spot.id))),
  ]);
  await writeAudit(db, {
    userId: c.get("user")!.id,
    action: "payment.cancel",
    entityType: "project",
    entityId: String(p.id),
    payload: { before: { paidKop: ps.paidKop, paidAt: ps.paidAt }, meta: { reason: body.reason, spotNumber: body.number } },
    ip: ip(c),
  });
  const fresh = await getProject(db, p.id);
  return c.json(await buildDetail(db, fresh!));
});

// Перехід статусу
projectsRouter.post("/:id/status/:transition", async (c) => {
  const db = createDb(c.env.DB);
  const p = await getProject(db, Number(c.req.param("id")));
  if (!p) return c.json(NOT_FOUND, 404);
  const t = c.req.param("transition");
  const uid = c.get("user")!.id;
  const audit = (action: string, payload?: unknown) => writeAudit(db, { userId: uid, action, entityType: "project", entityId: String(p.id), payload, ip: ip(c) });
  const bad = () => c.json({ error: { code: "bad_transition", message: "Неможливий перехід" } }, 409);

  if (t === "activate") {
    if (p.status !== "draft") return bad();
    const cnt = (await db.select({ n: sql<number>`count(*)` }).from(projectSpots).where(eq(projectSpots.projectId, p.id)))[0]?.n ?? 0;
    if (p.totalKop <= 0 || Number(cnt) < 1) return c.json({ error: { code: "guard", message: "Потрібні вартість > 0 і хоча б одне місце" } }, 409);
    const r = await db.update(projects).set({ status: "active", activatedAt: iso() }).where(and(eq(projects.id, p.id), eq(projects.status, "draft"))).returning({ id: projects.id });
    if (!r.length) return bad();
    await recalcAndPersist(db, p.id, p.totalKop);
    await audit("project.status_change", { to: "active" });
  } else if (t === "to_draft") {
    if (p.status !== "active") return bad();
    const paid = (await db.select({ n: sql<number>`count(*)` }).from(projectSpots).where(and(eq(projectSpots.projectId, p.id), sql`${projectSpots.paidAt} is not null`)))[0]?.n ?? 0;
    if (Number(paid) > 0) return c.json({ error: { code: "guard", message: "Спершу скасуйте всі оплати" } }, 409);
    const r = await db.update(projects).set({ status: "draft", activatedAt: null }).where(and(eq(projects.id, p.id), eq(projects.status, "active"))).returning({ id: projects.id });
    if (!r.length) return bad();
    await audit("project.status_change", { to: "draft" });
  } else if (t === "complete") {
    if (p.status !== "active") return bad();
    const r = await db.update(projects).set({ status: "completed", completedAt: iso() }).where(and(eq(projects.id, p.id), eq(projects.status, "active"))).returning({ id: projects.id });
    if (!r.length) return bad();
    // авто-нотатки сплаченим (idempotent: чистимо старі, вставляємо нові)
    const paidRows = await db
      .select({ spotId: projectSpots.spotId, shareKop: projectSpots.shareKop, paidKop: projectSpots.paidKop, paidAt: projectSpots.paidAt })
      .from(projectSpots)
      .where(and(eq(projectSpots.projectId, p.id), sql`${projectSpots.paidAt} is not null`));
    const completedDate = fmtDateUa(today());
    await db.delete(notes).where(and(eq(notes.projectId, p.id), eq(notes.kind, "project_auto")));
    if (paidRows.length) {
      const ins = paidRows.map((pr) => {
        const delta = pr.paidKop - pr.shareKop;
        let body = `Участь у проєкті «${p.title}» (завершено ${completedDate}).\nЧастка місця: ${fmtKop(pr.shareKop)} грн, сплачено: ${fmtKop(pr.paidKop)} грн (${fmtDateUa(pr.paidAt!)}).`;
        if (delta > 0) body += `\nПереплата: ${fmtKop(delta)} грн.`;
        else if (delta < 0) body += `\nДоплата: ${fmtKop(-delta)} грн.`;
        return db.insert(notes).values({ spotId: pr.spotId, kind: "project_auto", projectId: p.id, body });
      });
      await db.batch([ins[0], ...ins.slice(1)]);
    }
    await audit("project.status_change", { to: "completed", autoNotes: paidRows.length });
  } else if (t === "uncomplete") {
    if (p.status !== "completed") return bad();
    const r = await db.update(projects).set({ status: "active", completedAt: null }).where(and(eq(projects.id, p.id), eq(projects.status, "completed"))).returning({ id: projects.id });
    if (!r.length) return bad();
    await db.delete(notes).where(and(eq(notes.projectId, p.id), eq(notes.kind, "project_auto")));
    await audit("project.status_change", { to: "active", removedAutoNotes: true });
  } else if (t === "cancel") {
    if (p.status !== "active" && p.status !== "draft") return bad();
    const r = await db.update(projects).set({ status: "archived", cancelled: 1, archivedAt: iso() }).where(and(eq(projects.id, p.id), eq(projects.status, p.status))).returning({ id: projects.id });
    if (!r.length) return bad();
    await audit("project.status_change", { to: "archived", cancelled: true });
  } else if (t === "archive") {
    if (p.status !== "completed") return bad();
    const r = await db.update(projects).set({ status: "archived", archivedAt: iso() }).where(and(eq(projects.id, p.id), eq(projects.status, "completed"))).returning({ id: projects.id });
    if (!r.length) return bad();
    await audit("project.status_change", { to: "archived" });
  } else if (t === "unarchive") {
    if (p.status !== "archived" || p.cancelled === 1) return bad();
    const r = await db.update(projects).set({ status: "completed", archivedAt: null }).where(and(eq(projects.id, p.id), eq(projects.status, "archived"), eq(projects.cancelled, 0))).returning({ id: projects.id });
    if (!r.length) return bad();
    await audit("project.status_change", { to: "completed" });
  } else {
    return c.json({ error: { code: "bad_transition", message: "Невідомий перехід" } }, 400);
  }

  const fresh = await getProject(db, p.id);
  return c.json(await buildDetail(db, fresh!));
});
