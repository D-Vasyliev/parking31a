import { Hono } from "hono";
import type { Env, AppContext } from "./env";
import { csrf } from "./middleware";
import { authRouter } from "./routes/auth";
import { spotsRouter } from "./routes/spots";
import { ownersRouter } from "./routes/owners";
import { notesRouter } from "./routes/notes";
import { projectsRouter } from "./routes/projects";

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

// Заготовки під наступні етапи (audit) — під requireAuth.

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
    h.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
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

  // Етап 6: щонічний експорт D1 → R2.
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // TODO(stage-6): dump D1 → gzip → BACKUPS.put(`backups/parking-YYYY-MM-DD.sql.gz`)
  },
} satisfies ExportedHandler<Env>;
