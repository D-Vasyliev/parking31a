import { Hono } from "hono";
import { and, eq, isNull, lt, or } from "drizzle-orm";
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

/** Тривалість блокування: 5→15хв, 6→30хв, 7→1год… ≤ 24 год. */
function lockMs(fails: number): number {
  const over = Math.max(0, fails - LOCK_THRESHOLD);
  const mins = Math.min(15 * 2 ** over, 24 * 60);
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
  const body = await json(c, z.object({ email: z.string().min(1).max(320), password: z.string().min(1).max(200) }));
  const db = createDb(c.env.DB);
  const { ip } = meta(c);
  const now = Date.now();
  if (!body) return c.json(INVALID_CREDS, 401);

  const u = (await db.select().from(users).where(eq(users.email, body.email)).limit(1))[0];

  // Неіснуючий/неактивний: dummy-hash для вирівнювання часу, ідентична 401, аудит.
  if (!u || u.isActive !== 1) {
    await hashPassword(body.password);
    await writeAudit(db, { action: "auth.login_fail", ip, payload: { emailAttempted: body.email, reason: "no_user" } });
    return c.json(INVALID_CREDS, 401);
  }

  // Заблоковано: та сама відповідь (без enumeration), dummy-hash для вирівнювання часу.
  if (u.lockedUntil && Date.parse(u.lockedUntil) > now) {
    await hashPassword(body.password);
    return c.json(INVALID_CREDS, 401);
  }
  // Лок минув → нове вікно (щоб одна спроба не ре-локала за експонентою).
  let baseFails = u.failedLogins;
  if (u.lockedUntil) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
    baseFails = 0;
  }

  if (!(await verifyPassword(body.password, u.passwordHash))) {
    const fails = baseFails + 1;
    const locked = fails >= LOCK_THRESHOLD ? iso(now + lockMs(fails)) : null;
    await db.update(users).set({ failedLogins: fails, lockedUntil: locked }).where(eq(users.id, u.id));
    await writeAudit(db, { userId: u.id, action: locked ? "auth.lockout" : "auth.login_fail", ip });
    return c.json(INVALID_CREDS, 401);
  }

  // Пароль вірний. Лічильник НЕ скидаємо тут (скид лише після повного входу),
  // щоб знання пароля не давало необмежений бюджет спроб TOTP.
  const stage = u.mustChangePw === 1 || u.totpEnabled !== 1 ? "enroll" : "totp";
  const { cookie } = await createPending(db, u.id, stage);
  c.header("Set-Cookie", cookie);
  return c.json({ next: stage } satisfies LoginResult);
});

// ── Крок 2: TOTP або резервний код ──
authRouter.post("/totp", requirePending("totp"), async (c) => {
  const body = await json(c, z.object({ code: z.string().max(12).optional(), backupCode: z.string().max(40).optional() }));
  if (!body) return c.json({ error: { code: "bad_code", message: "Введіть код" } }, 400);
  const db = createDb(c.env.DB);
  const { ip, ua } = meta(c);
  const now = Date.now();
  const p = c.get("pending")!;
  const u = (await db.select().from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u || u.isActive !== 1) {
    await deletePending(db, p.id);
    c.header("Set-Cookie", clearCookie(PENDING_COOKIE));
    return c.json(INVALID_CREDS, 401);
  }
  // Акаунт заблоковано (напр., через невдалі TOTP) — не даємо продовжувати навіть із живим pending.
  if (u.lockedUntil && Date.parse(u.lockedUntil) > now) {
    await deletePending(db, p.id);
    c.header("Set-Cookie", clearCookie(PENDING_COOKIE));
    return c.json({ error: { code: "totp_locked", message: "Забагато спроб. Увійдіть пізніше." } }, 401);
  }

  let success = false;

  if (body.backupCode) {
    const h = await hashBackupCode(body.backupCode);
    // Атомарно: помічаємо використаним лише якщо ще не використаний.
    const upd = await db
      .update(recoveryCodes)
      .set({ usedAt: iso(now) })
      .where(and(eq(recoveryCodes.userId, u.id), eq(recoveryCodes.codeHash, h), isNull(recoveryCodes.usedAt)))
      .returning({ u: recoveryCodes.userId });
    if (upd.length === 1) {
      success = true;
      await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
    }
  } else if (body.code && u.totpSecret) {
    let secret: string | null = null;
    try {
      secret = await decryptSecret(u.totpSecret, c.env.TOTP_ENC_KEY);
    } catch {
      secret = null; // збій ключа/шифру → трактуємо як невдалу спробу (без 500)
    }
    if (secret) {
      const v = verifyTotp(secret, body.code.trim(), u.lastTotpStep, now);
      if (v.ok) {
        // Атомарний anti-replay: успіх лише якщо крок справді новий.
        const upd = await db
          .update(users)
          .set({ lastTotpStep: v.step, failedLogins: 0, lockedUntil: null })
          .where(and(eq(users.id, u.id), or(isNull(users.lastTotpStep), lt(users.lastTotpStep, v.step))))
          .returning({ id: users.id });
        success = upd.length === 1;
      }
    }
  }

  if (!success) {
    const pfails = await incPendingFails(db, p.id);
    const afails = u.failedLogins + 1;
    const locked = afails >= LOCK_THRESHOLD ? iso(now + lockMs(afails)) : null;
    await db.update(users).set({ failedLogins: afails, lockedUntil: locked }).where(eq(users.id, u.id));
    await writeAudit(db, { userId: u.id, action: "auth.totp_fail", ip });
    if (pfails >= MAX_TOTP_FAILS || locked) {
      await deletePending(db, p.id);
      c.header("Set-Cookie", clearCookie(PENDING_COOKIE));
      return c.json({ error: { code: "totp_locked", message: "Забагато спроб. Увійдіть пізніше." } }, 401);
    }
    return c.json({ error: { code: "bad_code", message: "Невірний код" } }, 401);
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
  const u = (
    await db.select({ email: users.email, mustChangePw: users.mustChangePw, isActive: users.isActive }).from(users).where(eq(users.id, p.userId)).limit(1)
  )[0];
  if (!u || u.isActive !== 1) return c.json(INVALID_CREDS, 401);
  return c.json({ mustChangePassword: u.mustChangePw === 1, email: u.email } satisfies EnrollStatus);
});

authRouter.post("/enroll/password", requirePending("enroll"), async (c) => {
  const body = await json(c, z.object({ newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200) }));
  if (!body) return c.json({ error: { code: "weak_password", message: `Пароль мінімум ${PASSWORD_MIN_LENGTH} символів` } }, 400);
  const db = createDb(c.env.DB);
  const { ip } = meta(c);
  const p = c.get("pending")!;
  const u = (await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u || u.isActive !== 1) return c.json(INVALID_CREDS, 401);
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePw: 0 }).where(eq(users.id, p.userId));
  await writeAudit(db, { userId: p.userId, action: "user.password_change", entityType: "user", entityId: String(p.userId), ip });
  return c.json({ ok: true });
});

authRouter.post("/enroll/totp/start", requirePending("enroll"), async (c) => {
  const db = createDb(c.env.DB);
  const p = c.get("pending")!;
  const u = (await db.select().from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u || u.isActive !== 1) return c.json(INVALID_CREDS, 401);
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
  const now = Date.now();
  const p = c.get("pending")!;
  const u = (await db.select().from(users).where(eq(users.id, p.userId)).limit(1))[0];
  if (!u || u.isActive !== 1) return c.json(INVALID_CREDS, 401);
  if (!u.totpSecret) return c.json({ error: { code: "no_secret", message: "Спершу згенеруйте QR-код" } }, 409);

  let secret: string;
  try {
    secret = await decryptSecret(u.totpSecret, c.env.TOTP_ENC_KEY);
  } catch {
    return c.json({ error: { code: "totp_unavailable", message: "Помилка конфігурації 2ФА" } }, 500);
  }
  const v = verifyTotp(secret, body.code.trim(), u.lastTotpStep, now);
  if (!v.ok) {
    const pfails = await incPendingFails(db, p.id);
    if (pfails >= MAX_TOTP_FAILS) {
      await deletePending(db, p.id);
      c.header("Set-Cookie", clearCookie(PENDING_COOKIE));
      return c.json({ error: { code: "totp_locked", message: "Забагато спроб. Увійдіть знову." } }, 401);
    }
    return c.json({ error: { code: "bad_code", message: "Невірний код" } }, 400);
  }

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
  const { ip } = meta(c);
  await destroyAllSessions(db, c.get("user")!.id);
  c.header("Set-Cookie", clearCookie(SESSION_COOKIE));
  await writeAudit(db, { userId: c.get("user")!.id, action: "auth.logout_all", ip });
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
      (r) => ({ id: r.id, current: r.id === cur, ip: r.ip, userAgent: r.ua, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt }) satisfies SessionInfo,
    ),
  );
});

// ── Безпека акаунта (етап 6) ──
authRouter.post("/change-password", requireAuth, async (c) => {
  const body = await json(c, z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200) }));
  if (!body) return c.json({ error: { code: "weak_password", message: `Пароль мінімум ${PASSWORD_MIN_LENGTH} символів` } }, 400);
  const db = createDb(c.env.DB);
  const { ip, ua } = meta(c);
  const uid = c.get("user")!.id;
  const u = (await db.select().from(users).where(eq(users.id, uid)).limit(1))[0];
  if (!u || !(await verifyPassword(body.currentPassword, u.passwordHash))) return c.json({ error: { code: "bad_current", message: "Невірний поточний пароль" } }, 400);
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePw: 0 }).where(eq(users.id, uid));
  await destroyAllSessions(db, uid); // вийти всюди
  const { cookie } = await createSession(db, uid, ip, ua); // поточний пристрій лишаємо залогіненим
  c.header("Set-Cookie", cookie);
  await writeAudit(db, { userId: uid, action: "user.password_change", entityType: "user", entityId: String(uid), ip });
  return c.json({ ok: true });
});

// Переналаштування 2ФА: новий секрет round-trip через клієнт (старий діє до підтвердження)
authRouter.post("/2fa/start", requireAuth, (c) => {
  const secret = generateSecretBase32();
  return c.json({ secret, otpauthUri: otpauthUri(secret, c.get("user")!.email) } satisfies EnrollTotpStartResult);
});
authRouter.post("/2fa/confirm", requireAuth, async (c) => {
  const body = await json(c, z.object({ password: z.string().min(1).max(200), code: z.string().min(6).max(8), secret: z.string().min(16).max(64) }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Некоректні дані" } }, 400);
  const db = createDb(c.env.DB);
  const { ip } = meta(c);
  const uid = c.get("user")!.id;
  const u = (await db.select().from(users).where(eq(users.id, uid)).limit(1))[0];
  if (!u || !(await verifyPassword(body.password, u.passwordHash))) return c.json({ error: { code: "bad_current", message: "Невірний пароль" } }, 400);
  const v = verifyTotp(body.secret, body.code.trim(), null, Date.now());
  if (!v.ok) return c.json({ error: { code: "bad_code", message: "Невірний код" } }, 400);
  const codes = generateBackupCodes();
  const hashes = await Promise.all(codes.map(hashBackupCode));
  const enc = await encryptSecret(body.secret, c.env.TOTP_ENC_KEY);
  await db.update(users).set({ totpSecret: enc, totpEnabled: 1, lastTotpStep: v.step }).where(eq(users.id, uid));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, uid));
  await db.insert(recoveryCodes).values(hashes.map((codeHash) => ({ userId: uid, codeHash })));
  await writeAudit(db, { userId: uid, action: "user.2fa_reset", entityType: "user", entityId: String(uid), ip });
  return c.json({ backupCodes: codes.map(formatBackupCode), user: toSessionUser(u) } satisfies EnrollConfirmResult);
});
authRouter.post("/backup-codes", requireAuth, async (c) => {
  const body = await json(c, z.object({ password: z.string().min(1).max(200) }));
  if (!body) return c.json({ error: { code: "bad_request", message: "Вкажіть пароль" } }, 400);
  const db = createDb(c.env.DB);
  const { ip } = meta(c);
  const uid = c.get("user")!.id;
  const u = (await db.select().from(users).where(eq(users.id, uid)).limit(1))[0];
  if (!u || !(await verifyPassword(body.password, u.passwordHash))) return c.json({ error: { code: "bad_current", message: "Невірний пароль" } }, 400);
  if (u.totpEnabled !== 1) return c.json({ error: { code: "no_2fa", message: "2ФА не увімкнено" } }, 409);
  const codes = generateBackupCodes();
  const hashes = await Promise.all(codes.map(hashBackupCode));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, uid));
  await db.insert(recoveryCodes).values(hashes.map((codeHash) => ({ userId: uid, codeHash })));
  await writeAudit(db, { userId: uid, action: "user.2fa_reset", entityType: "user", entityId: String(uid), payload: { backupCodesRegenerated: true }, ip });
  return c.json({ backupCodes: codes.map(formatBackupCode) });
});
