import { Hono } from "hono";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { auditLog, users } from "../db/schema";
import { requireAuth, requireAdmin } from "../middleware";
import type { AuditEntryView } from "../../shared/api";

export const auditRouter = new Hono<AppContext>();
auditRouter.use("*", requireAuth);
auditRouter.use("*", requireAdmin);

auditRouter.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const action = c.req.query("action");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 100, 500));
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);

  const conds = [];
  if (action) conds.push(eq(auditLog.action, action));
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) conds.push(gte(auditLog.at, from));
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) conds.push(lte(auditLog.at, `${to}T`)); // включно з усім днем to
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      payload: auditLog.payload,
      ip: auditLog.ip,
      email: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .offset(offset);

  return c.json(
    rows.map((r): AuditEntryView => ({ id: r.id, at: r.at, userEmail: r.email, action: r.action, entityType: r.entityType, entityId: r.entityId, payload: r.payload, ip: r.ip })),
  );
});
