// Спільні операції з прикріпленими файлами (метадані в D1, байти в R2 FILES).
import { and, asc, eq } from "drizzle-orm";
import type { Env } from "../env";
import { createDb } from "../db";
import { attachments, users } from "../db/schema";
import type { AttachmentView, AttachmentEntityType } from "../../shared/api";

type DB = ReturnType<typeof createDb>;

export async function listAttachments(db: DB, entityType: AttachmentEntityType, entityId: number): Promise<AttachmentView[]> {
  const rows = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      contentType: attachments.contentType,
      size: attachments.size,
      createdAt: attachments.createdAt,
      email: users.email,
    })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
    .orderBy(asc(attachments.id));
  return rows.map((r): AttachmentView => ({ id: r.id, filename: r.filename, contentType: r.contentType, size: r.size, createdAt: r.createdAt, uploadedByEmail: r.email }));
}

/** Прибрати всі файли сутності (R2-обʼєкти + рядки) — виклик при видаленні статті/проєкту/нотатки. */
export async function deleteAttachmentsFor(env: Env, db: DB, entityType: AttachmentEntityType, entityId: number): Promise<void> {
  const rows = await db
    .select({ r2Key: attachments.r2Key })
    .from(attachments)
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)));
  if (!rows.length) return;
  await Promise.all(rows.map((r) => env.FILES.delete(r.r2Key).catch(() => {})));
  await db.delete(attachments).where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)));
}
