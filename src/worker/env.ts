import type { SessionUser } from "../shared/api";

/** Прив'язки Worker (див. wrangler.jsonc). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BACKUPS: R2Bucket;
  FILES: R2Bucket;
  TOTP_ENC_KEY: string;
  APP_ENV: string;
}

export interface PendingInfo {
  id: string;
  userId: number;
  stage: "enroll" | "totp";
  totpFails: number;
}

/** Тип контексту Hono для всього застосунку. */
export type AppContext = {
  Bindings: Env;
  Variables: {
    user?: SessionUser;
    sessionId?: string;
    pending?: PendingInfo;
  };
};
