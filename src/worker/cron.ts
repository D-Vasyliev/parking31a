import type { Env } from "./env";

function sqlLit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array((v as ArrayBufferView).buffer);
    return `X'${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(text));
  void writer.close();
  return await new Response(cs.readable).arrayBuffer();
}

/** SQL-дамп усіх таблиць D1 → gzip → приватний R2. Повертає ключ обʼєкта. */
export async function runBackup(env: Env, dateStr: string): Promise<{ key: string; bytes: number; rows: number }> {
  const db = env.DB;
  const tablesRes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name")
    .all<{ name: string }>();
  // Відновлюваний дамп: DELETE + INSERT OR REPLACE — щоб виконуватись поверх схеми,
  // засідженої міграціями (0002 сідить 181 місце), без конфліктів UNIQUE (SPEC §3.7).
  let sql = `-- parking31a backup ${dateStr}\nPRAGMA foreign_keys=OFF;\n`;
  let rowCount = 0;
  for (const t of tablesRes.results) {
    sql += `DELETE FROM "${t.name}";\n`;
    const rows = (await db.prepare(`SELECT * FROM "${t.name}"`).all<Record<string, unknown>>()).results;
    for (const row of rows) {
      const cols = Object.keys(row);
      sql += `INSERT OR REPLACE INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => sqlLit(row[c])).join(",")});\n`;
      rowCount++;
    }
  }
  const gz = await gzip(sql);
  const key = `backups/parking-${dateStr}.sql.gz`;
  await env.BACKUPS.put(key, gz, { httpMetadata: { contentType: "application/gzip" } });
  return { key, bytes: gz.byteLength, rows: rowCount };
}

/** Прибирання протухлих сесій і pending-токенів. */
export async function cleanupExpired(env: Env, nowIso: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso),
    env.DB.prepare("DELETE FROM pending_auth WHERE expires_at < ?").bind(nowIso),
  ]);
}
