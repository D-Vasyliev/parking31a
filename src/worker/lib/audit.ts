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

/** Insert-стейтмент для audit_log (щоб класти в той самий db.batch, що й дію). */
export function auditIns(db: DB, entry: AuditEntry) {
  return db.insert(auditLog).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    payload: entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
    ip: entry.ip ?? null,
  });
}

/** Append-only запис у журнал аудиту (окремо, коли batch недоречний). */
export async function writeAudit(db: DB, entry: AuditEntry): Promise<void> {
  await auditIns(db, entry);
}
