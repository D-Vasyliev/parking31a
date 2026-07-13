import { Hono } from "hono";
import type { Env, AppContext } from "./env";
import { csrf, requireAuth, requireAdmin } from "./middleware";
import { authRouter } from "./routes/auth";
import { spotsRouter } from "./routes/spots";
import { ownersRouter } from "./routes/owners";
import { notesRouter } from "./routes/notes";
import { projectsRouter } from "./routes/projects";
import { searchRouter } from "./routes/search";
import { usersRouter } from "./routes/users";
import { auditRouter } from "./routes/audit";
import { articlesRouter } from "./routes/articles";
import { filesRouter } from "./routes/files";
import { runBackup, cleanupExpired } from "./cron";
import { createDb } from "./db";
import { writeAudit } from "./lib/audit";

const app = new Hono<AppContext>();

app.use("/api/*", csrf);

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "parking31a", env: c.env.APP_ENV ?? "dev", time: new Date().toISOString() }),
);

app.route("/api/auth", authRouter);
app.route("/api/spots", spotsRouter);
app.route("/api/owners", ownersRouter);
app.route("/api/notes", notesRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/search", searchRouter);
app.route("/api/users", usersRouter);
app.route("/api/audit", auditRouter);
app.route("/api/articles", articlesRouter);
app.route("/api/files", filesRouter);

// Ручний запуск бекапу (адмін)
app.post("/api/backup", requireAuth, requireAdmin, async (c) => {
  const date = new Date().toISOString().slice(0, 10);
  const res = await runBackup(c.env, date);
  await writeAudit(createDb(c.env.DB), {
    userId: c.get("user")!.id,
    action: "backup.run",
    entityType: "backup",
    entityId: res.key,
    payload: { bytes: res.bytes, rows: res.rows },
    ip: c.req.header("CF-Connecting-IP") ?? null,
  });
  return c.json({ ok: true, ...res });
});

app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Ендпоінт не знайдено" } }, 404));

// Не зливаємо стек-трейси клієнту; деталі — лише в лог.
app.onError((err, c) => {
  console.error("API error:", err);
  return c.json({ error: { code: "internal", message: "Внутрішня помилка сервера" } }, 500);
});

/** Додає security-заголовки до всіх відповідей; сувора CSP — лише поза localhost (щоб не ламати Vite HMR). */
function withSecurityHeaders(res: Response, url: URL): Response {
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!isLocal) {
    // Вміст файлів (PDF/зображення) вбудовується в застосунок через <iframe>/<img>,
    // тож дозволяємо framing тим самим origin і забороняємо активний вміст.
    const isFileRaw = url.pathname.startsWith("/api/files/") && url.pathname.endsWith("/raw");
    h.set(
      "Content-Security-Policy",
      isFileRaw
        ? "default-src 'none'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'"
        : "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const res = url.pathname.startsWith("/api/")
      ? await app.fetch(request, env, ctx)
      : await env.ASSETS.fetch(request);
    return withSecurityHeaders(res, url);
  },

  // Щоніч ~03:00 Києва: очистка протухлих сесій + бекап D1 → R2.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const now = new Date();
        // Бекап — пріоритет durability; виконуємо першим і окремо від очистки.
        try {
          await runBackup(env, now.toISOString().slice(0, 10));
        } catch (err) {
          console.error("scheduled backup failed:", err);
        }
        try {
          await cleanupExpired(env, now.toISOString());
        } catch (err) {
          console.error("scheduled cleanup failed:", err);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
