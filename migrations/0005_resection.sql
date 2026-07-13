-- Міграція 0005 — фактична схема паркінгу (звірено із замовником 13.07.2026 за фото).
-- Було: sheet 1 = №1–88 (секції А,Б), sheet 2 = №89–181 (секції В,Г).
-- Стало: поверх 1 (sheet 1) = №1–89, поверх 2 (sheet 2) = №90–181;
--        секція 1 = №1–43, секція 2 = №44–89, секція 3 = №90–133, секція 4 = №134–181.
-- Змінюється CHECK(section), тож spots перебудовується (SQLite не ALTER-ить CHECK).
-- Залежні таблиці (spot_owners/project_spots/notes) порожні → перенесення id безпечне.

CREATE TABLE spots_new (
  id         INTEGER PRIMARY KEY,
  number     TEXT NOT NULL UNIQUE,
  sheet      INTEGER NOT NULL CHECK (sheet IN (1,2)),
  section    TEXT NOT NULL CHECK (section IN ('1','2','3','4')),
  svg_id     TEXT UNIQUE,
  plate      TEXT,
  car_make   TEXT,
  car_model  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

INSERT INTO spots_new (id, number, sheet, section, svg_id, plate, car_make, car_model, created_at, updated_at)
SELECT
  id,
  number,
  CASE WHEN CAST(number AS INTEGER) <= 89 THEN 1 ELSE 2 END,
  CASE
    WHEN CAST(number AS INTEGER) <= 43  THEN '1'
    WHEN CAST(number AS INTEGER) <= 89  THEN '2'
    WHEN CAST(number AS INTEGER) <= 133 THEN '3'
    ELSE '4'
  END,
  svg_id, plate, car_make, car_model, created_at, updated_at
FROM spots;

DROP TABLE spots;
ALTER TABLE spots_new RENAME TO spots;
CREATE INDEX idx_spots_plate ON spots(plate);
