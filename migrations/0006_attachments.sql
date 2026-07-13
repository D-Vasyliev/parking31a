-- Міграція 0006 — прикріплені файли (attachments) для статей, проєктів і нотаток.
-- Байти файлів зберігаються в R2 (бакет parking31a-files, прив'язка FILES); тут лише метадані.
-- entity_type/entity_id — поліморфне посилання (без FK); прибирання при видаленні сутності
-- виконує застосунок (lib/attachments.ts).

CREATE TABLE attachments (
  id           INTEGER PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('article','project','note')),
  entity_id    INTEGER NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL DEFAULT 0,
  r2_key       TEXT NOT NULL UNIQUE,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);
