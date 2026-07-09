import { Hono } from "hono";
import { and, asc, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb, type DB } from "../db";
import { spots, spotOwners, owners, notes, users, projects, projectSpots } from "../db/schema";
import { requireAuth } from "../middleware";
import { auditIns } from "../lib/audit";
import { paymentStatus } from "../../shared/shares";
import type { Section } from "../../shared/spots";
import type { SpotSummary, SpotDetail, SpotOwnerView, OwnerHistoryEntry, NoteView, SpotProjectView } from "../../shared/api";

const NOT_FOUND = { error: { code: "not_found", message: "Місце не знайдено" } } as const;
const today = () => new Date().toISOString().slice(0, 10);
const SQL_NOW = sql`(datetime('now'))`;
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;

async function getSpot(db: DB, number: string) {
  return (await db.select().from(spots).where(eq(spots.number, number)).limit(1))[0];
}
async function hasPrimary(db: DB, spotId: number): Promise<boolean> {
  const r = await db
    .select({ id: spotOwners.id })
    .from(spotOwners)
    .where(and(eq(spotOwners.spotId, spotId), isNull(spotOwners.endedAt), eq(spotOwners.isPrimary, 1)))
    .limit(1);
  return r.length > 0;
}

async function buildDetail(db: DB, spot: typeof spots.$inferSelect): Promise<SpotDetail> {
  const ownerRows = await db
    .select({
      ownerId: owners.id,
      fullName: owners.fullName,
      phone: owners.phone,
      phone2: owners.phone2,
      email: owners.email,
      comment: owners.comment,
      isPrimary: spotOwners.isPrimary,
      startedAt: spotOwners.startedAt,
    })
    .from(spotOwners)
    .innerJoin(owners, eq(owners.id, spotOwners.ownerId))
    .where(and(eq(spotOwners.spotId, spot.id), isNull(spotOwners.endedAt)))
    .orderBy(desc(spotOwners.isPrimary));

  // Історія — лише завершені зв'язки (минулі власники), з детермінованим порядком.
  const historyRows = await db
    .select({ fullName: owners.fullName, isPrimary: spotOwners.isPrimary, startedAt: spotOwners.startedAt, endedAt: spotOwners.endedAt })
    .from(spotOwners)
    .innerJoin(owners, eq(owners.id, spotOwners.ownerId))
    .where(and(eq(spotOwners.spotId, spot.id), isNotNull(spotOwners.endedAt)))
    .orderBy(desc(spotOwners.endedAt), desc(spotOwners.id));

  const noteRows = await db
    .select({ id: notes.id, kind: notes.kind, body: notes.body, createdAt: notes.createdAt, projectId: notes.projectId, email: users.email })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.createdBy))
    .where(eq(notes.spotId, spot.id))
    .orderBy(desc(notes.createdAt), desc(notes.id));

  const projectRows = await db
    .select({
      projectId: projects.id,
      title: projects.title,
      status: projects.status,
      shareKop: projectSpots.shareKop,
      paidKop: projectSpots.paidKop,
      paidAt: projectSpots.paidAt,
    })
    .from(projectSpots)
    .innerJoin(projects, eq(projects.id, projectSpots.projectId))
    .where(eq(projectSpots.spotId, spot.id))
    .orderBy(desc(projects.id));

  return {
    number: Number(spot.number),
    section: spot.section as Section,
    sheet: spot.sheet,
    plate: spot.plate,
    carMake: spot.carMake,
    carModel: spot.carModel,
    owners: ownerRows.map(
      (r): SpotOwnerView => ({
        ownerId: r.ownerId,
        fullName: r.fullName,
        phone: r.phone,
        phone2: r.phone2,
        email: r.email,
        comment: r.comment,
        isPrimary: r.isPrimary === 1,
        startedAt: r.startedAt,
      }),
    ),
    history: historyRows.map((r): OwnerHistoryEntry => ({ fullName: r.fullName, isPrimary: r.isPrimary === 1, startedAt: r.startedAt, endedAt: r.endedAt })),
    notes: noteRows.map((r): NoteView => ({ id: r.id, kind: r.kind, body: r.body, createdAt: r.createdAt, createdByEmail: r.email, projectId: r.projectId })),
    projects: projectRows.map(
      (r): SpotProjectView => ({
        projectId: r.projectId,
        title: r.title,
        status: r.status,
        shareKop: r.shareKop,
        paidKop: r.paidKop,
        paidAt: r.paidAt,
        paymentStatus: paymentStatus(r.shareKop, r.paidKop, r.paidAt),
      }),
    ),
  };
}

export const spotsRouter = new Hono<AppContext>();
spotsRouter.use("*", requireAuth);

// Список для мапи — occupied за будь-яким чинним власником (primary дає ownerName)
spotsRouter.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({ number: spots.number, section: spots.section, sheet: spots.sheet, plate: spots.plate, ownerName: owners.fullName, ownerPhone: owners.phone, primary: spotOwners.isPrimary })
    .from(spots)
    .leftJoin(spotOwners, and(eq(spotOwners.spotId, spots.id), isNull(spotOwners.endedAt)))
    .leftJoin(owners, eq(owners.id, spotOwners.ownerId))
    .orderBy(asc(spots.id));

  // Місця з боргом: несплачена частка (>0) в активному проєкті.
  const debtRows = await db
    .selectDistinct({ number: spots.number })
    .from(projectSpots)
    .innerJoin(projects, eq(projects.id, projectSpots.projectId))
    .innerJoin(spots, eq(spots.id, projectSpots.spotId))
    .where(and(eq(projects.status, "active"), isNull(projectSpots.paidAt), sql`${projectSpots.shareKop} > 0`));
  const debt = new Set(debtRows.map((r) => r.number));

  // Кілька рядків на місце (primary + співвласники) — згортаємо.
  const map = new Map<string, SpotSummary>();
  for (const r of rows) {
    let s = map.get(r.number);
    if (!s) {
      s = { number: Number(r.number), section: r.section as Section, sheet: r.sheet, plate: r.plate, occupied: false, ownerName: null, ownerPhone: null, hasDebt: debt.has(r.number) };
      map.set(r.number, s);
    }
    if (r.ownerName) {
      s.occupied = true;
      if (r.primary === 1) {
        s.ownerName = r.ownerName;
        s.ownerPhone = r.ownerPhone;
      } else if (!s.ownerName) {
        s.ownerName = r.ownerName;
        s.ownerPhone = r.ownerPhone;
      }
    }
  }
  return c.json([...map.values()]);
});

spotsRouter.get("/:number", async (c) => {
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  return c.json(await buildDetail(db, spot));
});

spotsRouter.patch("/:number", async (c) => {
  const body = await parse(c, z.object({ plate: nstr(20), carMake: nstr(60), carModel: nstr(60) }).partial());
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  await db.batch([
    db.update(spots).set({ ...body, updatedAt: SQL_NOW }).where(eq(spots.id, spot.id)),
    auditIns(db, { userId: c.get("user")!.id, action: "spot.update", entityType: "spot", entityId: spot.number, payload: body, ip: ip(c) }),
  ]);
  const updated = (await db.select().from(spots).where(eq(spots.id, spot.id)).limit(1))[0];
  return c.json(await buildDetail(db, updated));
});

const ownerBody = z.object({
  fullName: z.string().min(1).max(200),
  phone: nstr(40),
  phone2: nstr(40),
  email: nstr(200),
  comment: nstr(1000),
});

// Замінити основного власника (з історією), атомарно
spotsRouter.put("/:number/owner", async (c) => {
  const body = await parse(c, ownerBody);
  if (!body) return c.json({ error: { code: "bad_request", message: "Вкажіть ПІП власника" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  const ins = await db.insert(owners).values(ownerValues(body)).returning({ id: owners.id });
  try {
    await db.batch([
      db.update(spotOwners).set({ endedAt: today() }).where(and(eq(spotOwners.spotId, spot.id), isNull(spotOwners.endedAt), eq(spotOwners.isPrimary, 1))),
      db.insert(spotOwners).values({ spotId: spot.id, ownerId: ins[0].id, isPrimary: 1, startedAt: today() }),
      auditIns(db, { userId: c.get("user")!.id, action: "spot.owner_change", entityType: "spot", entityId: spot.number, payload: { fullName: body.fullName }, ip: ip(c) }),
    ]);
  } catch {
    return c.json({ error: { code: "conflict", message: "Конфлікт одночасних змін. Спробуйте ще раз." } }, 409);
  }
  return c.json(await buildDetail(db, spot));
});

// Додати співвласника — лише за наявності основного (SPEC §2.7)
spotsRouter.post("/:number/coowner", async (c) => {
  const body = await parse(c, ownerBody);
  if (!body) return c.json({ error: { code: "bad_request", message: "Вкажіть ПІП співвласника" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  if (!(await hasPrimary(db, spot.id))) {
    return c.json({ error: { code: "no_primary", message: "Спершу призначте основного власника" } }, 409);
  }
  const ins = await db.insert(owners).values(ownerValues(body)).returning({ id: owners.id });
  await db.batch([
    db.insert(spotOwners).values({ spotId: spot.id, ownerId: ins[0].id, isPrimary: 0, startedAt: today() }),
    auditIns(db, { userId: c.get("user")!.id, action: "spot.owner_add", entityType: "spot", entityId: spot.number, payload: { fullName: body.fullName }, ip: ip(c) }),
  ]);
  return c.json(await buildDetail(db, spot));
});

// Завершити конкретний зв'язок власника (404, якщо чинного нема)
spotsRouter.delete("/:number/owner/:ownerId", async (c) => {
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  const ownerId = Number(c.req.param("ownerId"));
  if (!Number.isInteger(ownerId)) return c.json({ error: { code: "bad_request", message: "Некоректний власник" } }, 400);
  const upd = await db
    .update(spotOwners)
    .set({ endedAt: today() })
    .where(and(eq(spotOwners.spotId, spot.id), eq(spotOwners.ownerId, ownerId), isNull(spotOwners.endedAt)))
    .returning({ id: spotOwners.id });
  if (upd.length === 0) return c.json({ error: { code: "not_found", message: "Чинного власника не знайдено" } }, 404);
  await auditIns(db, { userId: c.get("user")!.id, action: "spot.owner_end", entityType: "spot", entityId: spot.number, payload: { ownerId }, ip: ip(c) });
  return c.json(await buildDetail(db, spot));
});

// Очистити місце (завершити всіх чинних)
spotsRouter.delete("/:number/owners", async (c) => {
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  await db.batch([
    db.update(spotOwners).set({ endedAt: today() }).where(and(eq(spotOwners.spotId, spot.id), isNull(spotOwners.endedAt))),
    auditIns(db, { userId: c.get("user")!.id, action: "spot.owner_end", entityType: "spot", entityId: spot.number, payload: { cleared: true }, ip: ip(c) }),
  ]);
  return c.json(await buildDetail(db, spot));
});

// Додати ручну нотатку
spotsRouter.post("/:number/notes", async (c) => {
  const body = await parse(c, z.object({ body: z.string().min(1).max(2000) }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Порожня нотатка" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  const ins = await db.insert(notes).values({ spotId: spot.id, kind: "manual", body: body.body, createdBy: c.get("user")!.id }).returning({ id: notes.id });
  await auditIns(db, { userId: c.get("user")!.id, action: "note.create", entityType: "note", entityId: String(ins[0].id), payload: { spotNumber: spot.number }, ip: ip(c) });
  return c.json(await buildDetail(db, spot));
});

// helpers
function ownerValues(b: z.infer<typeof ownerBody>) {
  return { fullName: b.fullName, phone: b.phone ?? null, phone2: b.phone2 ?? null, email: b.email ?? null, comment: b.comment ?? null };
}
function nstr(max: number) {
  return z.string().max(max).nullish();
}
async function parse<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const r = schema.safeParse(await c.req.json());
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
