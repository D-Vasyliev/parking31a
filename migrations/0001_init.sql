-- Міграція 0001 — початкова схема (див. docs/SPEC.md §2.2).
-- Гроші — INTEGER у копійках; дати — TEXT ISO-8601 UTC.

-- ─── Користувачі та автентифікація ─────────────────────────────
CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,              -- 'pbkdf2$sha256$100000$<salt_b64>$<hash_b64>'
  role           TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
  totp_secret    TEXT,                        -- base32, зашифрований AES-256-GCM (ключ TOTP_ENC_KEY)
  totp_enabled   INTEGER NOT NULL DEFAULT 0,
  last_totp_step INTEGER,                     -- anti-replay TOTP
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  must_change_pw INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recovery_codes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,                   -- SHA-256; 10 одноразових кодів
  used_at    TEXT,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,              -- SHA-256 від токена з cookie
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),  -- абсолютний максимум 30 діб
  expires_at   TEXT NOT NULL,                 -- rolling 7 діб
  last_seen_at TEXT,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ─── Власники та місця ─────────────────────────────────────────
CREATE TABLE owners (
  id         INTEGER PRIMARY KEY,
  full_name  TEXT NOT NULL,
  phone      TEXT,
  phone2     TEXT,
  email      TEXT,
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_owners_name ON owners(full_name);

CREATE TABLE spots (
  id         INTEGER PRIMARY KEY,
  number     TEXT NOT NULL UNIQUE,            -- '1'…'181'
  sheet      INTEGER NOT NULL CHECK (sheet IN (1,2)),
  section    TEXT NOT NULL CHECK (section IN ('А','Б','В','Г')),
  svg_id     TEXT UNIQUE,
  plate      TEXT,
  car_make   TEXT,
  car_model  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_spots_plate ON spots(plate);

CREATE TABLE spot_owners (
  id         INTEGER PRIMARY KEY,
  spot_id    INTEGER NOT NULL REFERENCES spots(id)  ON DELETE CASCADE,
  owner_id   INTEGER NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL DEFAULT (date('now')),
  ended_at   TEXT
);
CREATE UNIQUE INDEX uq_spot_current_primary
  ON spot_owners(spot_id) WHERE ended_at IS NULL AND is_primary = 1;
CREATE INDEX idx_spot_owners_owner ON spot_owners(owner_id);
CREATE INDEX idx_spot_owners_spot  ON spot_owners(spot_id);

-- ─── Проєкти ───────────────────────────────────────────────────
CREATE TABLE projects (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  total_kop     INTEGER NOT NULL DEFAULT 0 CHECK (total_kop >= 0),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','active','completed','archived')),
  cancelled     INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at  TEXT,
  completed_at  TEXT,
  archived_at   TEXT
);

CREATE TABLE project_spots (
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spot_id        INTEGER NOT NULL REFERENCES spots(id)    ON DELETE RESTRICT,
  share_kop      INTEGER NOT NULL DEFAULT 0,
  paid_kop       INTEGER NOT NULL DEFAULT 0,
  paid_at        TEXT,
  paid_marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payment_method TEXT CHECK (payment_method IN ('cash','transfer','other')),
  payment_note   TEXT,
  added_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, spot_id),
  CHECK ((paid_at IS NULL AND paid_kop = 0) OR (paid_at IS NOT NULL AND paid_kop > 0))
);
CREATE INDEX idx_project_spots_spot ON project_spots(spot_id);

-- ─── Нотатки ───────────────────────────────────────────────────
CREATE TABLE notes (
  id         INTEGER PRIMARY KEY,
  spot_id    INTEGER NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','project_auto')),
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  CHECK (kind = 'manual' OR project_id IS NOT NULL)
);
CREATE INDEX idx_notes_spot ON notes(spot_id);
CREATE UNIQUE INDEX uq_notes_project_auto
  ON notes(spot_id, project_id) WHERE kind = 'project_auto';

-- ─── Аудит ─────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  payload     TEXT,
  ip          TEXT
);
CREATE INDEX idx_audit_at     ON audit_log(at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
