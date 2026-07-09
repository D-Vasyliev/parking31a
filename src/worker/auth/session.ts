// Сесії у D1: повні сесії (cookie __Host-session) та pending для двофазного входу.
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { sessions, pendingAuth, users } from "../db/schema";
import type { SessionUser } from "../../shared/api";
import { randomBytes, toB64Url, sha256Hex } from "../lib/crypto";

const DAY = 86_400_000;
const SESSION_TTL = 7 * DAY;
const SESSION_ABS_MAX = 30 * DAY;
const PENDING_TTL = 5 * 60_000;
const LAST_SEEN_THROTTLE = 5 * 60_000;

export type Stage = "enroll" | "totp";
export const SESSION_COOKIE = "__Host-session";
export const PENDING_COOKIE = "__Host-pending";

const iso = (ms: number) => new Date(ms).toISOString();

function buildCookie(name: string, value: string, maxAgeSec: number): string {
  return [`${name}=${value}`, "HttpOnly", "Secure", "SameSite=Strict", "Path=/", `Max-Age=${maxAgeSec}`].join("; ");
}
export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k) out[k] = part.slice(idx + 1).trim();
  }
  return out;
}

// ── Повні сесії ──
export async function createSession(db: DB, userId: number, ip: string | null, ua: string | null): Promise<{ token: string; cookie: string }> {
  const token = toB64Url(randomBytes(32));
  const id = await sha256Hex(token);
  const now = Date.now();
  await db.insert(sessions).values({
    id,
    userId,
    createdAt: iso(now),
    expiresAt: iso(now + SESSION_TTL),
    lastSeenAt: iso(now),
    ip,
    userAgent: ua,
  });
  return { token, cookie: buildCookie(SESSION_COOKIE, token, SESSION_TTL / 1000) };
}

export async function validateSession(db: DB, token: string): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token) return null;
  const id = await sha256Hex(token);
  const now = Date.now();
  const rows = await db
    .select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      uid: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.isActive !== 1) return null;
  if (Date.parse(row.expiresAt) <= now) return null;
  if (row.createdAt && now - Date.parse(row.createdAt) > SESSION_ABS_MAX) return null;

  const lastSeen = row.lastSeenAt ? Date.parse(row.lastSeenAt) : 0;
  if (now - lastSeen > LAST_SEEN_THROTTLE) {
    await db.update(sessions).set({ lastSeenAt: iso(now), expiresAt: iso(now + SESSION_TTL) }).where(eq(sessions.id, id));
  }
  return { user: { id: row.uid, email: row.email, role: row.role }, sessionId: id };
}

export async function destroySession(db: DB, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
export async function destroyAllSessions(db: DB, userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ── Pending (двофазний вхід) ──
export async function createPending(db: DB, userId: number, stage: Stage): Promise<{ token: string; cookie: string }> {
  const token = toB64Url(randomBytes(32));
  const id = await sha256Hex(token);
  const now = Date.now();
  await db.delete(pendingAuth).where(eq(pendingAuth.userId, userId)); // один pending на користувача
  await db.insert(pendingAuth).values({ id, userId, stage, createdAt: iso(now), expiresAt: iso(now + PENDING_TTL) });
  return { token, cookie: buildCookie(PENDING_COOKIE, token, PENDING_TTL / 1000) };
}

export async function getPending(
  db: DB,
  token: string,
): Promise<{ id: string; userId: number; stage: Stage; totpFails: number } | null> {
  if (!token) return null;
  const id = await sha256Hex(token);
  const rows = await db.select().from(pendingAuth).where(eq(pendingAuth.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.parse(row.expiresAt) <= Date.now()) {
    await db.delete(pendingAuth).where(eq(pendingAuth.id, id));
    return null;
  }
  return { id: row.id, userId: row.userId, stage: row.stage as Stage, totpFails: row.totpFails };
}

export async function incPendingFails(db: DB, id: string): Promise<number> {
  const rows = await db
    .update(pendingAuth)
    .set({ totpFails: sql`${pendingAuth.totpFails} + 1` })
    .where(eq(pendingAuth.id, id))
    .returning({ f: pendingAuth.totpFails });
  return rows[0]?.f ?? 0;
}

export async function setPendingStage(db: DB, id: string, stage: Stage): Promise<void> {
  await db.update(pendingAuth).set({ stage }).where(eq(pendingAuth.id, id));
}

export async function deletePending(db: DB, id: string): Promise<void> {
  await db.delete(pendingAuth).where(eq(pendingAuth.id, id));
}
