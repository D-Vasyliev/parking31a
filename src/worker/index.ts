import { Hono } from "hono";

/**
 * Прив'язки Worker (див. wrangler.jsonc).
 * Пізніше замінимо на згенеровані типи `wrangler types` за потреби.
 */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BACKUPS: R2Bucket;
  TOTP_ENC_KEY: string;
  APP_ENV: string;
}

const api = new Hono<{ Bindings: Env }>();

api.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "parking31a",
    env: c.env.APP_ENV ?? "dev",
    time: new Date().toISOString(),
  }),
);

// Заготовки під наступні етапи (auth, spots, owners, projects, notes, audit).
api.notFound((c) => c.json({ error: { code: "not_found", message: "Ендпоінт не знайдено" } }, 404));

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }
    // Усе інше — статика SPA (у dev проксі на Vite з HMR).
    return env.ASSETS.fetch(request);
  },

  // Етап 6: щонічний експорт D1 → R2.
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // TODO(stage-6): dump D1 → gzip → BACKUPS.put(`backups/parking-YYYY-MM-DD.sql.gz`)
  },
} satisfies ExportedHandler<Env>;
