-- Міграція 0004 — «Технічна інформація по паркінгу»: короткі статті (заголовок + опис).
-- Читають усі авторизовані; редагують лише адміністратори (гейт на рівні API).

CREATE TABLE tech_articles (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tech_articles_updated ON tech_articles(updated_at);
