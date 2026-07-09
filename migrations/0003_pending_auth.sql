-- Міграція 0003 — короткоживучі pending-сесії для двофазного входу (пароль → 2ФА/enrollment).
-- Див. SPEC §3.4. Токен у cookie __Host-pending; тут зберігаємо його SHA-256.

CREATE TABLE pending_auth (
  id         TEXT PRIMARY KEY,               -- SHA-256 від токена з cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage      TEXT NOT NULL CHECK (stage IN ('enroll','totp')),
  totp_fails INTEGER NOT NULL DEFAULT 0,     -- 5 невдалих кодів → pending знищується
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL                   -- TTL 5 хв
);
CREATE INDEX idx_pending_user ON pending_auth(user_id);
