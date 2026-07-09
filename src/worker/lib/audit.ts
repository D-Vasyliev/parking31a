import type { DB } from "../db";
import { auditLog } from "../db/schema";

export interface AuditEntry {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: string;
  payload?: unknown;
  ip?: string | null;
}

/** Append-only запис у журнал аудиту (у тій самій БД). */
export async function writeAudit(db: DB, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    payload: entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
    ip: entry.ip ?? null,
  });
}
