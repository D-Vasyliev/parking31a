import { createMiddleware } from "hono/factory";
import type { AppContext } from "./env";
import { createDb } from "./db";
import { validateSession, getPending, parseCookies, SESSION_COOKIE, PENDING_COOKIE, type Stage } from "./auth/session";

/** Вимагає чинну повну сесію (__Host-session). */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const token = parseCookies(c.req.header("Cookie") ?? null)[SESSION_COOKIE];
  const res = token ? await validateSession(createDb(c.env.DB), token) : null;
  if (!res) return c.json({ error: { code: "unauthorized", message: "Потрібен вхід" } }, 401);
  c.set("user", res.user);
  c.set("sessionId", res.sessionId);
  await next();
});

/** Вимагає чинну pending-сесію заданого етапу (enroll | totp). */
export function requirePending(stage: Stage) {
  return createMiddleware<AppContext>(async (c, next) => {
    const token = parseCookies(c.req.header("Cookie") ?? null)[PENDING_COOKIE];
    const p = token ? await getPending(createDb(c.env.DB), token) : null;
    if (!p || p.stage !== stage) {
      return c.json({ error: { code: "no_pending", message: "Сесія входу недійсна. Увійдіть знову." } }, 401);
    }
    c.set("pending", p);
    await next();
  });
}

/**
 * CSRF: для мутуючих методів вимагаємо same-origin.
 * Браузер надсилає Sec-Fetch-Site; якщо його нема — перевіряємо Origin проти Host.
 * Запити без обох заголовків (server-to-server) пропускаємо.
 */
export const csrf = createMiddleware<AppContext>(async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    const site = c.req.header("Sec-Fetch-Site");
    if (site) {
      if (site !== "same-origin" && site !== "none") {
        return c.json({ error: { code: "csrf", message: "Заборонено (CSRF)" } }, 403);
      }
    } else {
      const origin = c.req.header("Origin");
      if (origin) {
        try {
          if (new URL(origin).host !== c.req.header("Host")) {
            return c.json({ error: { code: "csrf", message: "Заборонено (CSRF)" } }, 403);
          }
        } catch {
          return c.json({ error: { code: "csrf", message: "Заборонено (CSRF)" } }, 403);
        }
      }
    }
  }
  await next();
});
