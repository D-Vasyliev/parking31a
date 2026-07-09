import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { users, recoveryCodes, sessions } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  generateSecretBase32,
  otpauthUri,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  hashBackupCode,
  formatBackupCode,
} from "../auth/totp";
import {
  createSession,
  createPending,
  destroySession,
  destroyAllSessions,
  incPendingFails,
  deletePending,
  clearCookie,
  SESSION_COOKIE,
  PENDING_COOKIE,
} from "../auth/session";
import { requireAuth, requirePending } from "../middleware";
import { writeAudit } from "../lib/audit";
import { PASSWORD_MIN_LENGTH } from "../../shared/api";
import type {
  LoginResult,
  AuthOkResult,
  EnrollStatus,
  EnrollTotpStartResult,
  EnrollConfirmResult,
  MeResult,
  SessionInfo,
  SessionUser,
} from "../../shared/api";

const LOCK_THRESHOLD = 5;
const MAX_TOTP_FAILS = 5;

const INVALID_CREDS = { error: { code: "invalid_credentials", message: "Невірний email або пароль" } } as const;

const iso = (ms: number) => new Date(ms).toISOString();

function lockMs(fails: number): number {
  const over = Math.max(0, fails - LOCK_THRESHOLD); // 5→0, 6→1…
  const mins = Math.min(15 * 2 ** over, 24 * 60); // 15,30,60… ≤ 24 год
  return mins * 60_000;
}

function meta(c: { req: { header: (n: string) => string | undefined } }): { ip: string | null; ua: string | null } {
  return { ip: c.req.header("CF-Connecting-IP") ?? null, ua: c.req.header("User-Agent") ?? null };
}

function toSessionUser(u: { id: number; email: string; role: "admin" | "viewer" }): SessionUser {
  return { id: u.id, email: u.email, role: u.role };
}

async function json<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const parsed = schema.safeParse(await c.req.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const authRouter = new Hono<AppContext>();

// ── Крок 1: пароль ──
authRouter.post("/login", async (c) => {
  const body = await json(c, z.object({ email: z.string().min(1), password: z.string().min(1) }));
  if (!body) return c.json(INVALID_CREDS, 401);
  const db = createDb(c.env.DB);
  const { ip } = meta(c);
  const now = Date.now();

  const u = (await db.select().from(users).where(eq(users.email, body.email)).limit(1))[0];

  if (!u || u.isActive !== 1) {
    await hashPassword(body.password); // вирівнюємо час (анти-enumeration)
    return c.json(INVALID_CREDS, 401);
  }
  if (u.lockedUntil && Date.parse(u.lockedUntil) > now) {
    return c.json({ error: { code: "locked", message: "Забагато спроб. Спробуйте пізніше." } }, 429);
  }
  if (!(await verifyPassword(body.password, u.passwordHash))) {
    const fails = u.failedLogins + 1;
    const locked = fails >= LOCK_THRESHOLD ? iso(now + lockMs(fails)) : null;
    await db.update(users).set({ failedLogins: fails, lockedUntil: locked }).where(eq(users.id, u.id));
    await writeAudit(db, { userId: u.id, action: locked ? "auth.lockout" : "auth.login_fail", ip });
    return c.json(INVALID_CREDS, 401);
  }

  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  const stage = u.mustChangePw === 1 || u.totpEnabled !== 1 ? "enroll" : "totp";
  const { cookie } = await createPending(db, u.id, stage);
  c.header("Set-Cookie", cookie);
  return c.json({ next: stage } satisfies LoginResult);
});

// ── Крок 2: TOTP або резервний код ──
authRouter.post("/totp", requirePending("totp"), async (c) => {
  const body = await json(c, z.object({ code: z.string().optional(), backupCode: z.string().optional() }));
  if (!body) return c.json({ error: { code: "bad_code", message: "Введіть код" } }, 400);
  const db = createDb(c.env.DB);
  const { ip, ua } = meta(c);
  const p = c.get("pending")!;
  const u = (await db.select().from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u) return c.json(INVALID_CREDS, 401);

  let success = false;
  let step: number | null = null;

  if (body.backupCode) {
    const h = await hashBackupCode(body.backupCode);
    const rc = (
      await db.select().from(recoveryCodes).where(and(eq(recoveryCodes.userId, u.id), eq(recoveryCodes.codeHash, h))).limit(1)
    )[0];
    if (rc && !rc.usedAt) {
      await db
        .update(recoveryCodes)
        .set({ usedAt: iso(Date.now()) })
        .where(and(eq(recoveryCodes.userId, u.id), eq(recoveryCodes.codeHash, h)));
      success = true;
    }
  } else if (body.code && u.totpSecret) {
    const secret = await decryptSecret(u.totpSecret, c.env.TOTP_ENC_KEY);
    const v = verifyTotp(secret, body.code.trim(), u.lastTotpStep, Date.now());
    if (v.ok) {
      success = true;
      step = v.step;
    }
  }

  if (!success) {
    const fails = await incPendingFails(db, p.id);
    await writeAudit(db, { userId: u.id, action: "auth.totp_fail", ip });
    if (fails >= MAX_TOTP_FAILS) {
      await deletePending(db, p.id);
      c.header("Set-Cookie", clearCookie(PENDING_COOKIE));
      return c.json({ error: { code: "totp_locked", message: "Забагато спроб. Увійдіть знову." } }, 401);
    }
    return c.json({ error: { code: "bad_code", message: "Невірний код" } }, 401);
  }

  if (step !== null) {
    await db.update(users).set({ lastTotpStep: step, failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  }
  await deletePending(db, p.id);
  const { cookie } = await createSession(db, u.id, ip, ua);
  c.header("Set-Cookie", clearCookie(PENDING_COOKIE));
  c.header("Set-Cookie", cookie, { append: true });
  await writeAudit(db, { userId: u.id, action: "auth.login_ok", ip });
  return c.json({ user: toSessionUser(u) } satisfies AuthOkResult);
});

// ── Enrollment (перший вхід) ──
authRouter.get("/enroll/status", requirePending("enroll"), async (c) => {
  const db = createDb(c.env.DB);
  const p = c.get("pending")!;
  const u = (await db.select({ email: users.email, mustChangePw: users.mustChangePw }).from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u) return c.json(INVALID_CREDS, 401);
  return c.json({ mustChangePassword: u.mustChangePw === 1, email: u.email } satisfies EnrollStatus);
});

authRouter.post("/enroll/password", requirePending("enroll"), async (c) => {
  const body = await json(c, z.object({ newPassword: z.string().min(PASSWORD_MIN_LENGTH) }));
  if (!body) return c.json({ error: { code: "weak_password", message: `Пароль мінімум ${PASSWORD_MIN_LENGTH} символів` } }, 400);
  const db = createDb(c.env.DB);
  const { ip } = meta(c);
  const p = c.get("pending")!;
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePw: 0 }).where(eq(users.id, p.userId));
  await writeAudit(db, { userId: p.userId, action: "user.password_change", entityType: "user", entityId: String(p.userId), ip });
  return c.json({ ok: true });
});

authRouter.post("/enroll/totp/start", requirePending("enroll"), async (c) => {
  const db = createDb(c.env.DB);
  const p = c.get("pending")!;
  const u = (await db.select().from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u) return c.json(INVALID_CREDS, 401);
  if (u.mustChangePw === 1) return c.json({ error: { code: "password_first", message: "Спершу змініть тимчасовий пароль" } }, 409);
  const secret = generateSecretBase32();
  await db.update(users).set({ totpSecret: await encryptSecret(secret, c.env.TOTP_ENC_KEY), totpEnabled: 0 }).where(eq(users.id, u.id));
  return c.json({ secret, otpauthUri: otpauthUri(secret, u.email) } satisfies EnrollTotpStartResult);
});

authRouter.post("/enroll/totp/confirm", requirePending("enroll"), async (c) => {
  const body = await json(c, z.object({ code: z.string().min(6).max(8) }));
  if (!body) return c.json({ error: { code: "bad_code", message: "Введіть код" } }, 400);
  const db = createDb(c.env.DB);
  const { ip, ua } = meta(c);
  const p = c.get("pending")!;
  const u = (await db.select().from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u || !u.totpSecret) return c.json({ error: { code: "no_secret", message: "Спершу згенеруйте QR-код" } }, 409);

  const secret = await decryptSecret(u.totpSecret, c.env.TOTP_ENC_KEY);
  const v = verifyTotp(secret, body.code.trim(), u.lastTotpStep, Date.now());
  if (!v.ok) return c.json({ error: { code: "bad_code", message: "Невірний код" } }, 400);

  const codes = generateBackupCodes();
  const hashes = await Promise.all(codes.map(hashBackupCode));
  await db.update(users).set({ totpEnabled: 1, lastTotpStep: v.step, failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id));
  await db.insert(recoveryCodes).values(hashes.map((codeHash) => ({ userId: u.id, codeHash })));

  await deletePending(db, p.id);
  const { cookie } = await createSession(db, u.id, ip, ua);
  c.header("Set-Cookie", clearCookie(PENDING_COOKIE));
  c.header("Set-Cookie", cookie, { append: true });
  await writeAudit(db, { userId: u.id, action: "user.2fa_enable", entityType: "user", entityId: String(u.id), ip });
  await writeAudit(db, { userId: u.id, action: "auth.login_ok", ip });
  return c.json({ backupCodes: codes.map(formatBackupCode), user: toSessionUser(u) } satisfies EnrollConfirmResult);
});

// ── Сесія користувача ──
authRouter.get("/me", requireAuth, (c) => c.json({ user: c.get("user")! } satisfies MeResult));

authRouter.post("/logout", requireAuth, async (c) => {
  const db = createDb(c.env.DB);
  const { ip } = meta(c);
  await destroySession(db, c.get("sessionId")!);
  c.header("Set-Cookie", clearCookie(SESSION_COOKIE));
  await writeAudit(db, { userId: c.get("user")!.id, action: "auth.logout", ip });
  return c.json({ ok: true });
});

authRouter.post("/logout-all", requireAuth, async (c) => {
  const db = createDb(c.env.DB);
  await destroyAllSessions(db, c.get("user")!.id);
  c.header("Set-Cookie", clearCookie(SESSION_COOKIE));
  return c.json({ ok: true });
});

authRouter.get("/sessions", requireAuth, async (c) => {
  const db = createDb(c.env.DB);
  const cur = c.get("sessionId")!;
  const rows = await db
    .select({ id: sessions.id, ip: sessions.ip, ua: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .where(eq(sessions.userId, c.get("user")!.id));
  return c.json(
    rows.map(
      (r) =>
        ({ id: r.id, current: r.id === cur, ip: r.ip, userAgent: r.ua, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt }) satisfies SessionInfo,
    ),
  );
});
