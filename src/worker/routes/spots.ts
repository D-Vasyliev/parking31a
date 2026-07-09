import { Hono } from "hono";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb, type DB } from "../db";
import { spots, spotOwners, owners, notes, users } from "../db/schema";
import { requireAuth } from "../middleware";
import { writeAudit } from "../lib/audit";
import type { Section } from "../../shared/spots";
import type { SpotSummary, SpotDetail, SpotOwnerView, OwnerHistoryEntry, NoteView } from "../../shared/api";

const NOT_FOUND = { error: { code: "not_found", message: "Місце не знайдено" } } as const;
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;

async function getSpot(db: DB, number: string) {
  return (await db.select().from(spots).where(eq(spots.number, number)).limit(1))[0];
}

async function buildDetail(db: DB, spot: typeof spots.$inferSelect): Promise<SpotDetail> {
  const ownerRows = await db
    .select({
      ownerId: owners.id,
      fullName: owners.fullName,
      phone: owners.phone,
      phone2: owners.phone2,
      email: owners.email,
      isPrimary: spotOwners.isPrimary,
      startedAt: spotOwners.startedAt,
    })
    .from(spotOwners)
    .innerJoin(owners, eq(owners.id, spotOwners.ownerId))
    .where(and(eq(spotOwners.spotId, spot.id), isNull(spotOwners.endedAt)))
    .orderBy(desc(spotOwners.isPrimary));

  const historyRows = await db
    .select({
      fullName: owners.fullName,
      isPrimary: spotOwners.isPrimary,
      startedAt: spotOwners.startedAt,
      endedAt: spotOwners.endedAt,
    })
    .from(spotOwners)
    .innerJoin(owners, eq(owners.id, spotOwners.ownerId))
    .where(eq(spotOwners.spotId, spot.id))
    .orderBy(desc(spotOwners.startedAt));

  const noteRows = await db
    .select({
      id: notes.id,
      kind: notes.kind,
      body: notes.body,
      createdAt: notes.createdAt,
      projectId: notes.projectId,
      email: users.email,
    })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.createdBy))
    .where(eq(notes.spotId, spot.id))
    .orderBy(desc(notes.createdAt));

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
        isPrimary: r.isPrimary === 1,
        startedAt: r.startedAt,
      }),
    ),
    history: historyRows.map(
      (r): OwnerHistoryEntry => ({ fullName: r.fullName, isPrimary: r.isPrimary === 1, startedAt: r.startedAt, endedAt: r.endedAt }),
    ),
    notes: noteRows.map(
      (r): NoteView => ({ id: r.id, kind: r.kind, body: r.body, createdAt: r.createdAt, createdByEmail: r.email, projectId: r.projectId }),
    ),
  };
}

export const spotsRouter = new Hono<AppContext>();
spotsRouter.use("*", requireAuth);

// Список для мапи
spotsRouter.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      number: spots.number,
      section: spots.section,
      sheet: spots.sheet,
      ownerName: owners.fullName,
    })
    .from(spots)
    .leftJoin(
      spotOwners,
      and(eq(spotOwners.spotId, spots.id), isNull(spotOwners.endedAt), eq(spotOwners.isPrimary, 1)),
    )
    .leftJoin(owners, eq(owners.id, spotOwners.ownerId))
    .orderBy(asc(spots.id));
  return c.json(
    rows.map(
      (r): SpotSummary => ({
        number: Number(r.number),
        section: r.section as Section,
        sheet: r.sheet,
        occupied: r.ownerName != null,
        ownerName: r.ownerName,
      }),
    ),
  );
});

// Деталі картки
spotsRouter.get("/:number", async (c) => {
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  return c.json(await buildDetail(db, spot));
});

// Дані авто
spotsRouter.patch("/:number", async (c) => {
  const body = await parse(c, z.object({ plate: nstr(20), carMake: nstr(60), carModel: nstr(60) }).partial());
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  await db.update(spots).set({ ...body, updatedAt: nowIso() }).where(eq(spots.id, spot.id));
  await writeAudit(db, { userId: c.get("user")!.id, action: "spot.update", entityType: "spot", entityId: spot.number, payload: body, ip: ip(c) });
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

// Змінити (замінити) основного власника — зі збереженням історії
spotsRouter.put("/:number/owner", async (c) => {
  const body = await parse(c, ownerBody);
  if (!body) return c.json({ error: { code: "bad_request", message: "Вкажіть ПІП власника" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  await db
    .update(spotOwners)
    .set({ endedAt: today() })
    .where(and(eq(spotOwners.spotId, spot.id), isNull(spotOwners.endedAt), eq(spotOwners.isPrimary, 1)));
  const ins = await db
    .insert(owners)
    .values({ fullName: body.fullName, phone: body.phone, phone2: body.phone2, email: body.email, comment: body.comment })
    .returning({ id: owners.id });
  await db.insert(spotOwners).values({ spotId: spot.id, ownerId: ins[0].id, isPrimary: 1, startedAt: today() });
  await writeAudit(db, { userId: c.get("user")!.id, action: "spot.owner_change", entityType: "spot", entityId: spot.number, payload: { fullName: body.fullName }, ip: ip(c) });
  return c.json(await buildDetail(db, spot));
});

// Додати співвласника
spotsRouter.post("/:number/coowner", async (c) => {
  const body = await parse(c, ownerBody);
  if (!body) return c.json({ error: { code: "bad_request", message: "Вкажіть ПІП співвласника" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  const ins = await db
    .insert(owners)
    .values({ fullName: body.fullName, phone: body.phone, phone2: body.phone2, email: body.email, comment: body.comment })
    .returning({ id: owners.id });
  await db.insert(spotOwners).values({ spotId: spot.id, ownerId: ins[0].id, isPrimary: 0, startedAt: today() });
  await writeAudit(db, { userId: c.get("user")!.id, action: "spot.owner_add", entityType: "spot", entityId: spot.number, payload: { fullName: body.fullName }, ip: ip(c) });
  return c.json(await buildDetail(db, spot));
});

// Завершити конкретний зв'язок власника
spotsRouter.delete("/:number/owner/:ownerId", async (c) => {
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  const ownerId = Number(c.req.param("ownerId"));
  await db
    .update(spotOwners)
    .set({ endedAt: today() })
    .where(and(eq(spotOwners.spotId, spot.id), eq(spotOwners.ownerId, ownerId), isNull(spotOwners.endedAt)));
  await writeAudit(db, { userId: c.get("user")!.id, action: "spot.owner_end", entityType: "spot", entityId: spot.number, payload: { ownerId }, ip: ip(c) });
  return c.json(await buildDetail(db, spot));
});

// Очистити місце (завершити всіх чинних власників)
spotsRouter.delete("/:number/owners", async (c) => {
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  await db.update(spotOwners).set({ endedAt: today() }).where(and(eq(spotOwners.spotId, spot.id), isNull(spotOwners.endedAt)));
  await writeAudit(db, { userId: c.get("user")!.id, action: "spot.owner_end", entityType: "spot", entityId: spot.number, payload: { cleared: true }, ip: ip(c) });
  return c.json(await buildDetail(db, spot));
});

// Додати ручну нотатку
spotsRouter.post("/:number/notes", async (c) => {
  const body = await parse(c, z.object({ body: z.string().min(1).max(2000) }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Порожня нотатка" } }, 400);
  const db = createDb(c.env.DB);
  const spot = await getSpot(db, c.req.param("number"));
  if (!spot) return c.json(NOT_FOUND, 404);
  await db.insert(notes).values({ spotId: spot.id, kind: "manual", body: body.body, createdBy: c.get("user")!.id });
  await writeAudit(db, { userId: c.get("user")!.id, action: "note.create", entityType: "spot", entityId: spot.number, ip: ip(c) });
  return c.json(await buildDetail(db, spot));
});

// helpers
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
