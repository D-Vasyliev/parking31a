import { Hono } from "hono";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { owners, spotOwners, spots } from "../db/schema";
import { requireAuth } from "../middleware";
import { writeAudit } from "../lib/audit";
import type { Section } from "../../shared/spots";
import type { OwnerListItem, OwnerDetail } from "../../shared/api";

const nowIso = () => new Date().toISOString();
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("CF-Connecting-IP") ?? null;

export const ownersRouter = new Hono<AppContext>();
ownersRouter.use("*", requireAuth);

// Довідник: власники з чинними місцями
ownersRouter.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({ id: owners.id, fullName: owners.fullName, phone: owners.phone, spotNumber: spots.number })
    .from(owners)
    .innerJoin(spotOwners, and(eq(spotOwners.ownerId, owners.id), isNull(spotOwners.endedAt)))
    .innerJoin(spots, eq(spots.id, spotOwners.spotId))
    .orderBy(asc(owners.fullName));

  const byId = new Map<number, OwnerListItem>();
  for (const r of rows) {
    let o = byId.get(r.id);
    if (!o) {
      o = { id: r.id, fullName: r.fullName, phone: r.phone, spots: [] };
      byId.set(r.id, o);
    }
    o.spots.push(Number(r.spotNumber));
  }
  const list = [...byId.values()];
  for (const o of list) o.spots.sort((a, b) => a - b);
  return c.json(list);
});

ownersRouter.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const o = (await db.select().from(owners).where(eq(owners.id, id)).limit(1))[0];
  if (!o) return c.json({ error: { code: "not_found", message: "Власника не знайдено" } }, 404);
  const spotRows = await db
    .select({ number: spots.number, section: spots.section })
    .from(spotOwners)
    .innerJoin(spots, eq(spots.id, spotOwners.spotId))
    .where(and(eq(spotOwners.ownerId, id), isNull(spotOwners.endedAt)))
    .orderBy(asc(spots.id));
  return c.json({
    id: o.id,
    fullName: o.fullName,
    phone: o.phone,
    phone2: o.phone2,
    email: o.email,
    comment: o.comment,
    spots: spotRows.map((s) => ({ number: Number(s.number), section: s.section as Section })),
  } satisfies OwnerDetail);
});

// Виправити дані власника (застосовується до всіх його місць)
const ownerPatchSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).nullish(),
  phone2: z.string().max(40).nullish(),
  email: z.string().max(200).nullish(),
  comment: z.string().max(1000).nullish(),
});
ownersRouter.patch("/:id", async (c) => {
  let body: z.infer<typeof ownerPatchSchema> | null = null;
  try {
    const parsed = ownerPatchSchema.safeParse(await c.req.json());
    if (parsed.success) body = parsed.data;
  } catch {
    body = null;
  }
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const o = (await db.select().from(owners).where(eq(owners.id, id)).limit(1))[0];
  if (!o) return c.json({ error: { code: "not_found", message: "Власника не знайдено" } }, 404);
  await db.update(owners).set({ ...body, updatedAt: nowIso() }).where(eq(owners.id, id));
  await writeAudit(db, { userId: c.get("user")!.id, action: "owner.update", entityType: "owner", entityId: String(id), payload: body, ip: ip(c) });
  return c.json({ ok: true });
});
