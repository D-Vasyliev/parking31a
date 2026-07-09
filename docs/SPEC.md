# Специфікація: Система керування паркінгом
**Об'єкт:** підземний паркінг ЖК, пр. Правди 31-33 / 31-А, Київ (Подільський р-н)
**Версія:** 1.1 · 09.07.2026 · статус: **погоджено із замовником** (відкриті дрібниці — розд. 8)
**Реалізація:** окремою сесією (Opus 4.8) за цим документом. Розділ 8 — відкриті питання, які треба закрити до/під час реалізації.

---

## 1. Огляд системи

Приватний адміністративний сайт (1–3 користувачі) для керування 181 машиномісцем (№1–181, суцільна нумерація): картки місць із даними власників, колективні «проєкти» (камери, шлагбаум…) з автоматичним поділом вартості на місця-учасники, мультивибір на інтерактивній мапі, повний журнал дій. Доступ — тільки логін (email) + пароль + TOTP 2ФА.

**Стек (зафіксовано):**

| Шар | Рішення |
|---|---|
| Хостинг | Один Cloudflare Worker: Static Assets (SPA) + Hono API. Pages не використовуємо (деприоритизовано) |
| БД | Cloudflare D1 (SQLite) + Drizzle ORM (схема в TS, міграції — SQL-файли через `wrangler d1 migrations`) |
| Фронтенд | Vite + React 18 + TypeScript; наявна vanilla-JS SVG-мапа (`reference/parking-scheme.html`) ізолюється в модуль `src/client/map/` з програмним API і монтується через ref/useEffect |
| Сесії | **D1** (не KV — потрібна миттєва ревокація) |
| Бекапи | D1 Time Travel + нічний SQL-дамп у приватний R2 (cron) |
| CI/CD | GitHub Actions → wrangler (міграції → деплой) |
| Вартість | Free tier покриває все; платне — лише домен (~$10–15/рік) |

**Ключові наскрізні рішення:**
- Гроші — тільки `INTEGER` у копійках (`_kop`), жодних float. UI-формат: `2 500,00 грн` (кома — укр. стандарт).
- Дата/час — `TEXT` ISO-8601 UTC; відображення `dd.mm.yyyy` за Києвом.
- Оплата — зафіксований факт, який ніколи не перезаписується перерахунком; частка — похідна величина.
- «Зайнятість» місця — похідна: місце зайняте, якщо має чинного власника. Окремого ручного статусу немає.
- Ідентифікатор входу — **email** (у таблиці `users` поле `email`).
- Всі мутації → запис в audit log у тій самій транзакції.

---

## 2. Модель даних (D1 / SQLite)

### 2.1 Сутності

| Таблиця | Призначення |
|---|---|
| `users` | Адміністратори; email + пароль + TOTP |
| `sessions` | Сесії (D1); id = SHA-256 від токена з cookie |
| `recovery_codes` | 10 одноразових кодів відновлення 2ФА |
| `owners` | Власники — окрема сутність (один власник ↔ кілька місць) |
| `spots` | Машиномісця (~180); авто — атрибут місця |
| `spot_owners` | Володіння з історією (`ended_at IS NULL` = чинне); покриває зміну власника і співвласність |
| `projects` | Колективні покращення |
| `project_spots` | Учасники проєкту: частка + факт оплати |
| `notes` | Нотатки до місця: ручні та автогенеровані |
| `audit_log` | Append-only журнал |

### 2.2 DDL

```sql
-- ─── Користувачі та автентифікація ─────────────────────────────
CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,              -- 'pbkdf2$sha256$100000$<salt_b64>$<hash_b64>'
  role           TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
  totp_secret    TEXT,                       -- base32, зашифрований AES-256-GCM (ключ TOTP_ENC_KEY)
  totp_enabled   INTEGER NOT NULL DEFAULT 0,
  last_totp_step INTEGER,                    -- anti-replay: останній використаний time-step
  failed_logins  INTEGER NOT NULL DEFAULT 0, -- 5 невдач → locked_until = now + 15 хв (експоненційно до 24 год)
  locked_until   TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  must_change_pw INTEGER NOT NULL DEFAULT 1, -- перший вхід: зміна тимчасового пароля
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recovery_codes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,                  -- SHA-256; 10 одноразових кодів при вмиканні 2ФА
  used_at    TEXT,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,             -- SHA-256 від 32-байтного випадкового токена з cookie
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),  -- абсолютний максимум життя: 30 діб від created_at
  expires_at   TEXT NOT NULL,                -- rolling 7 діб, подовжується при використанні
  last_seen_at TEXT,                         -- оновлюється не частіше 1 разу на 5 хв
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ─── Власники та місця ─────────────────────────────────────────
CREATE TABLE owners (
  id         INTEGER PRIMARY KEY,
  full_name  TEXT NOT NULL,
  phone      TEXT,                           -- нормалізований '+380…'
  phone2     TEXT,
  email      TEXT,
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_owners_name ON owners(full_name);

CREATE TABLE spots (
  id         INTEGER PRIMARY KEY,
  number     TEXT NOT NULL UNIQUE,           -- '1'…'88' (аркуш 1), '89'…'181' (аркуш 2)
  sheet      INTEGER NOT NULL CHECK (sheet IN (1,2)),  -- 1 = секції А/Б, 2 = В/Г
  section    TEXT NOT NULL CHECK (section IN ('А','Б','В','Г')),
  svg_id     TEXT UNIQUE,                    -- прив'язка до елемента SVG-мапи
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
  is_primary INTEGER NOT NULL DEFAULT 1,     -- 1 = основний, 0 = співвласник
  started_at TEXT NOT NULL DEFAULT (date('now')),
  ended_at   TEXT                            -- NULL = чинний
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
  cancelled     INTEGER NOT NULL DEFAULT 0,  -- 1 = заархівовано без реалізації
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at  TEXT,
  completed_at  TEXT,
  archived_at   TEXT
);

CREATE TABLE project_spots (
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spot_id        INTEGER NOT NULL REFERENCES spots(id)    ON DELETE RESTRICT,
  share_kop      INTEGER NOT NULL DEFAULT 0,  -- розрахована частка (перераховує система)
  paid_kop       INTEGER NOT NULL DEFAULT 0,  -- фактично сплачено (фіксується вручну)
  paid_at        TEXT,
  paid_marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payment_method TEXT CHECK (payment_method IN ('cash','transfer','other')),
  payment_note   TEXT,                        -- 'єдиний переказ за місця 12, 47' тощо
  added_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, spot_id),
  -- не сплачено → paid_kop=0; сплачено → paid_kop>=0 (дозволяє частку 0 для дешевих проєктів)
  CHECK (paid_kop >= 0 AND (paid_at IS NOT NULL OR paid_kop = 0))
);
CREATE INDEX idx_project_spots_spot ON project_spots(spot_id);

-- ─── Нотатки ───────────────────────────────────────────────────
CREATE TABLE notes (
  id         INTEGER PRIMARY KEY,
  spot_id    INTEGER NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','project_auto')),
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL для авто
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  CHECK (kind = 'manual' OR project_id IS NOT NULL)
);
CREATE INDEX idx_notes_spot ON notes(spot_id);
CREATE UNIQUE INDEX uq_notes_project_auto
  ON notes(spot_id, project_id) WHERE kind = 'project_auto';   -- ідемпотентність автонотаток

-- ─── Аудит ─────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,       -- 'spot'|'owner'|'project'|'project_spot'|'note'|'user'|'auth'
  entity_id   TEXT,       -- id або 'projectId:spotId'
  payload     TEXT,       -- JSON {before, after, meta} — лише змінені поля
  ip          TEXT
);
CREATE INDEX idx_audit_at     ON audit_log(at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
```

**Seed (міграція №1):** 181 місце — №1–88 (аркуш 1, секції А/Б) та №89–181 (аркуш 2, секції В/Г). Розподіл по секціях/рядах — за схемою v1, **підтверджений замовником 09.07.2026**. Позиція №89 на мапі — початок верхнього ряду острівця секції В (перед №90); звірити візуально на оновленій схемі.

### 2.3 Поділ вартості (округлення копійок)

Чиста детермінована функція; викликається при будь-якій зміні складу учасників або `total_kop`:

```
base = ⌊total_kop / n⌋;  remainder = total_kop − base·n   (0 ≤ remainder < n)
Місця сортуються за зростанням номера; перші `remainder` місць отримують base+1 коп., решта — base.
> ⚠️ Реалізація: `number` — TEXT, тож сортувати **числово** — `ORDER BY CAST(number AS INTEGER)`,
> інакше лексикографічний порядок (1,10,11,…,2) віддасть залишок не тим місцям.
```

**Приклад:** 12 345,67 грн на 37 місць → `base = 33 366` коп., залишок 25 → **25 місць по 333,67 грн + 12 місць по 333,66 грн** = 1 234 567 коп. рівно.

UI: на сторінці проєкту — формула-розгортка «333,67 грн × 25 + 333,66 грн × 12 = 12 345,67 грн», підказка ⓘ «залишок від ділення розподілено по 1 коп. між місцями з найменшими номерами». Повторний перерахунок за тих самих вхідних — той самий результат (детермінізм).

### 2.4 Додавання/вилучення місць після оплат

Принцип: **частка перераховується всім поточним учасникам; зафіксовані оплати незмінні; розбіжність — дельта.**

1. Зміна складу або суми (у статусі `active`) → перерахунок `share_kop` усім в одній транзакції.
2. `delta = paid_kop − share_kop` (обчислюється на льоту):
   - `paid_at IS NULL` → «Не сплачено»;
   - `delta = 0` → «Сплачено» ✓;
   - `delta > 0` → «Сплачено, переплата 25,03 грн» (додали місця);
   - `delta < 0` → «Сплачено, доплата 12,40 грн» (вилучили місця).
3. Підсумок проєкту: «Зібрано Σpaid із total», окремо Σпереплат і Σдоплат. Повернення/дозбір — офлайн; система показує точні суми.
4. **Вилучити місце, що вже сплатило, не можна** (409): спершу «Скасувати оплату» (обов'язкове поле «причина», аудитується), потім вилучення. Свідоме відхилення від «місця можна вилучати будь-коли» — щоб факт оплати не зникав тихо.
5. Перед перерахунком, що зачіпає сплачені місця, — підтвердження з прев'ю: «Частка зміниться з 333,67 до 308,65 грн; у 10 місць виникне переплата 25,02 грн».

### 2.5 Життєвий цикл проєкту

```
draft ──активувати──▶ active ──завершити──▶ completed ──архівувати──▶ archived
  ▲                    │  ▲                     │                        │
  └── у чернетку ──────┘  └──── розвершити ─────┘        розархівувати ──▶ completed
      (guard: 0 оплат)
active ──скасувати──▶ archived (cancelled=1)
```

| Статус | Редагування | Оплати | Переходи (guard) |
|---|---|---|---|
| **draft** | все | заборонені | → active (total>0, учасників ≥1); hard delete дозволено |
| **active** | назва/опис; сума та склад — з перерахунком і підтвердженням | так | → completed (якщо є несплачені — підтвердження зі списком); → draft (0 оплат); → archived+cancelled |
| **completed** | read-only | ні | → active («розвершити», видаляє автонотатки); → archived |
| **archived** | read-only | ні | → completed (тільки якщо cancelled=0) |

Переходи — умовним `UPDATE … WHERE status='<очікуваний>'` (конкурентно-безпечно). **Видалити можна тільки `draft`; проєкт, де будь-коли були оплати, — лише архів.**

### 2.6 Автонотатки при завершенні

- **Тригер:** перехід active→completed, в одній транзакції.
- **Отримують:** тільки місця з `paid_at IS NOT NULL`. Відсутність нотатки = «не брав участі». (Несплачена участь видима у вкладці «Проєкти» картки.)
- **Формат** (kind=`project_auto`, created_by=NULL, бейдж «авто» в UI):

  ```
  Участь у проєкті «Відеоспостереження» (завершено 09.07.2026).
  Частка місця: 333,67 грн, сплачено: 333,67 грн (15.03.2026).
  ```
  За розбіжності — третій рядок: `Переплата: 25,03 грн.` / `Доплата: 12,40 грн.`
- **Ідемпотентність:** унікальний частковий індекс + `INSERT OR IGNORE` + одноразовість переходу статусу.
- **Розвершення:** `DELETE … WHERE project_id=? AND kind='project_auto'` у тій самій транзакції. Ручні нотатки не зачіпаються ніколи. Виправлення помилкової оплати в завершеному проєкті: розвершити → виправити → завершити (нотатки перегенеруються).

### 2.7 Крайові випадки

- **Зміна власника:** чинному запису `spot_owners` ставиться `ended_at`, створюється новий. Історія видима у вкладці картки. `owners` не видаляються (`RESTRICT`).
- **Борг при зміні власника посеред проєкту:** частка/оплата прив'язані до **місця** — новий власник успадковує борг місця. Автонотатка лишається в історії місця. *(Підтвердити із замовником — розд. 8, п.6.)*
- **Співвласність:** додатковий рядок `is_primary=0`. Основний власник рівно один. На проєкти не впливає (частка — на місце).
- **Місце без власника:** валідний стан («Власник не вказаний»); може брати участь у проєктах.
- **Помилкове «сплачено»:** «Скасувати оплату» з обов'язковою причиною → paid=0 + аудит зі старими значеннями.
- **Один власник платить за кілька місць:** режим «Відмітити оплату для кількох місць» — сума часток показується, одна дія ставить кожному місцю його `paid_kop = share_kop`, спільні дата/спосіб/нотатка. У БД — N незалежних рядків.

### 2.8 Журнал аудиту

Append-only, у тій самій транзакції, що й дія. Перегляди (read) не логуються. **Retention: без чистки** (масштаб — тисячі рядків/рік). Значення ПД у `payload.before/after` дозволені — аудит живе в тій самій захищеній БД, інакше «до/після» безглузді.

**Дії:** `auth.login_ok|login_fail|totp_fail|logout|lockout`; `owner.create|update|delete`; `spot.update|owner_change|owner_add|owner_end`; `note.create|update|delete`; `project.create|update|delete|status_change|total_change|spot_add|spot_remove|recalc`; `payment.mark|cancel`; `user.create|update|disable|2fa_enable|2fa_reset`; `import.apply`.

**Payload:** `{"before":{"paid_kop":33367,"paid_at":"2026-03-15"},"after":{"paid_kop":0,"paid_at":null},"meta":{"reason":"відмічено не те місце","project_title":"Відеоспостереження","spot_number":"47"}}` — `meta` дублює людиночитний контекст на момент дії.

---

## 3. Автентифікація та безпека

### 3.1 Загальне рішення

Власна автентифікація **email + пароль + TOTP** на Workers (Hono middleware), сесії в **D1**. Cloudflare Access не використовуємо (двоступеневий вхід незручний для 1–3 адмінів; вимога замовника — саме логін/пароль у системі). Опція на майбутнє: Access вмикається перед сайтом без зміни коду. Реєстрації немає — акаунти створює seed-скрипт/інший адмін; перший вхід = обов'язкова зміна пароля + обов'язковий enrollment 2ФА.

### 3.2 Паролі

- WebCrypto `deriveBits`, **PBKDF2-HMAC-SHA-256, 100 000 ітерацій** (жорсткий максимум Workers runtime), salt 16 байт/користувача, ключ 32 байти.
- Формат: `pbkdf2$sha256$100000$<salt_b64>$<hash_b64>` (самоописний — міграція параметрів безболісна).
- Порівняння — `crypto.subtle.timingSafeEqual`.
- 100k < рекомендації OWASP → компенсатори обов'язкові: згенеровані паролі ≥16 символів (політика: мін. 12), lockout, 2ФА.

### 3.3 TOTP 2ФА (RFC 6238)

- HMAC-SHA-1, 6 цифр, період 30 с, вікно ±1 крок. Бібліотека: **`otpauth`** (працює на Workers).
- Секрет: 20 випадкових байт, Base32; у D1 — **зашифрований AES-256-GCM** (ключ — секрет `TOTP_ENC_KEY` у Workers Secrets; IV 12 байт/запис, зберігаємо `iv||ciphertext` base64).
- Provisioning: `otpauth://totp/Parking:{email}?secret=…&issuer=Parking&algorithm=SHA1&digits=6&period=30`; QR рендериться **на клієнті** (бібліотека `qrcode`) — секрет не йде на сторонні сервіси. Активація — після першого валідного коду.
- Anti-replay: `users.last_totp_step` — коди з тим самим/старішим step відхиляються.
- **Резервні коди: 10** одноразових по 10 символів (~50 біт ентропії), показуються один раз, зберігаються SHA-256-хешами; регенерація анулює старі.

### 3.4 Сесії

- **D1** (KV eventually consistent до ~60 с — «вийти всюди» і блокування мали б затримку).
- Двофазний вхід: пароль ОК → короткоживучий `__Host-pending2fa` (TTL 5 хв, дозволяє тільки ендпоінт TOTP) → TOTP ОК → повна сесія (pending знищується).
- Токен: 32 випадкові байти base64url; у D1 — SHA-256 від токена (дамп БД не дає живих сесій).
- Cookie: **`__Host-session`**; `HttpOnly; Secure; SameSite=Strict; Path=/`.
- Життя: rolling 7 діб + **абсолютний максимум 30 діб від `created_at`**; `last_seen_at` — не частіше 1 разу/5 хв. Ротація id при кожному підвищенні привілеїв.
- Logout = видалення рядка; «Вийти всюди» = `DELETE … WHERE user_id` (кнопка в профілі; автоматично при зміні пароля/скиданні 2ФА). У профілі — список активних сесій.
- CSRF: `SameSite=Strict` + перевірка `Origin`/`Sec-Fetch-Site` на мутуючих методах.
- Cron щодоби чистить протухлі сесії та pending-токени.

### 3.5 Захист від перебору

1. Per-account lockout: 5 невдач → 15 хв, далі експоненційно до 24 год; скидання при успіху. TOTP: 5 невдалих кодів → pending-токен знищується.
2. Cloudflare WAF Rate Limiting на `/api/auth/*`: ~10 зап./хв з IP, блок 10 хв (доступно на Free).
3. Bot Fight Mode. Turnstile — лише якщо в логах з'явиться перебір (увага: потребує розширення CSP — стороннiй скрипт).
4. Без user enumeration: єдина відповідь «Невірний email або пароль», однаковий час виконання (dummy-хеш для неіснуючого email).

### 3.6 Персональні дані (ЗУ «Про захист персональних даних»)

- Тільки в D1 (шифрується at rest у Cloudflare); жодних ПД у кеші/localStorage. Мінімізація полів.
- Усі `/api/*` крім login — тільки за сесією; HTTPS примусово (Always Use HTTPS + HSTS 1 рік).
- **Не логувати ніколи:** паролі, TOTP-коди/секрети, резервні коди, токени сесій; у діагностичних логах телефони — масковані (`+380••••••45`); request body у Workers Logs не вмикати. (В audit_log ПД у payload дозволені — розд. 2.8.)
- Видалення даних власника на вимогу — штатна операція; копії в бекапах спливають за retention (180 діб).
- Заголовки: `CSP: default-src 'self'` (нуль сторонніх скриптів), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- SQLi: тільки prepared statements (`.prepare().bind()` / Drizzle).

### 3.7 Бекапи та відновлення

- **Лінія 1 — D1 Time Travel:** point-in-time restore 7 діб (Free) / 30 діб (Paid). `wrangler d1 time-travel restore parking-db --timestamp=…`
- **Лінія 2 — нічний дамп:** Cron `0 1 * * *` (≈03:00 Києва) → Worker генерує **SQL-дамп** → gzip → приватний R2: `backups/parking-YYYY-MM-DD.sql.gz`. Lifecycle R2: **180 діб**.
- Катастрофа: нова D1 → `wrangler d1 execute parking-db --remote --file=dump.sql` → перев'язати binding.
- Раз на квартал — тестове відновлення дампа в тимчасову БД.
- **Break-glass (єдиний адмін втратив телефон + резервні коди):** офіційний runbook — `wrangler d1 execute parking-db --remote --command "UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE email='…'"` з консолі власника Cloudflare-акаунта; наступний вхід вимагає повторний enrollment. Дія фіксується вручну в журналі.
- **Секрети:** єдиний перелік — `TOTP_ENC_KEY` (через `wrangler secret put`); локально `.dev.vars` у `.gitignore`; деплой-токен CF — тільки в GitHub Actions Secrets.

### 3.8 Модель загроз

| # | Загроза | Мітигація |
|---|---|---|
| 1 | Перебір паролів / credential stuffing | Lockout, WAF rate limit, паролі ≥16, TOTP, без enumeration |
| 2 | Викрадення сесії через XSS | HttpOnly, CSP `self`, нуль сторонніх скриптів, екранування |
| 3 | CSRF | SameSite=Strict + перевірка Origin |
| 4 | Фішинг адміна | HSTS, єдиний домен, інструктаж, TOTP-вікно 30 с |
| 5 | SQL-ін'єкція | Prepared statements, zod-валідація |
| 6 | Витік ПД через логи/бекапи | Заборона ПД у діаг. логах, приватний R2, retention 180 діб |
| 7 | Втрата 2ФА-пристрою | 10 резервних кодів; скидання іншим адміном; break-glass runbook |
| 8 | Колишній адмін / інсайдер | Іменні акаунти, деактивація + «вийти всюди» однією дією, audit log |
| 9 | Втрата даних | Time Travel + нічні дампи R2 + тестові відновлення |

---

## 4. Інфраструктура Cloudflare та деплой

### 4.1 Архітектура

```
Браузер ──▶ parking.<домен> ──▶ Worker
                                 ├─ /api/*  → Hono (auth middleware → D1)
                                 └─ інше    → Static Assets (SPA, SPA-fallback)
```
- `run_worker_first: ["/api/*"]`; `not_found_handling: "single-page-application"`.
- Один Worker = один деплой, один домен, нуль CORS (критично для session cookies).

### 4.2 Структура репозиторію

```
parking/
├── package.json
├── wrangler.jsonc
├── vite.config.ts              # @cloudflare/vite-plugin + react
├── drizzle.config.ts
├── migrations/                 # SQL (генерує drizzle-kit, застосовує wrangler)
├── src/
│   ├── worker/                 # Hono backend
│   │   ├── index.ts            # export default { fetch, scheduled }
│   │   ├── routes/             # auth.ts, spots.ts, owners.ts, projects.ts, notes.ts, audit.ts, import.ts
│   │   ├── auth/               # сесії (D1), PBKDF2, TOTP, middleware
│   │   ├── db/schema.ts        # Drizzle-схема
│   │   └── cron.ts             # нічний SQL-дамп D1 → R2
│   ├── client/                 # React SPA
│   │   ├── pages/              # Map, Projects, Owners, Settings, Login
│   │   ├── components/
│   │   └── map/                # адаптований vanilla SVG-модуль схеми
│   └── shared/                 # DTO-типи, константи
├── scripts/create-admin.ts     # хеш пароля + TOTP QR + INSERT через wrangler d1 execute
├── .github/workflows/deploy.yml
└── docs/SPEC.md                # цей документ
```

### 4.3 wrangler.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "parking-pravdy",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [{
    "binding": "DB", "database_name": "parking-db",
    "database_id": "<uuid після wrangler d1 create>",
    "migrations_dir": "./migrations"
  }],
  "r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "parking-backups" }],
  "triggers": { "crons": ["0 1 * * *"] },
  "observability": { "enabled": true },
  "vars": { "APP_ENV": "production" }
}
```
KV не використовується (сесії в D1). Секрети — тільки `wrangler secret put TOTP_ENC_KEY`.

### 4.4 Середовища

- **Local dev:** `vite dev` з `@cloudflare/vite-plugin` (workerd + Miniflare-емуляції D1/R2, HMR, один порт). Локальна БД: `wrangler d1 migrations apply parking-db --local` + seed із тестовими даними.
- **Production:** єдине середовище, деплой з `main`. Preview-деплої не потрібні; разово — `wrangler versions upload` (preview-URL без перемикання трафіку).

### 4.5 CI/CD — GitHub Actions

Міграції D1 застосовуються **до** деплою коду, окремим кроком:

```yaml
name: Deploy
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck && npm test --if-present
      - run: npm run build
      - name: Apply D1 migrations
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply parking-db --remote
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```
Токен: шаблон "Edit Cloudflare Workers" + D1:Edit → GitHub Secrets.

### 4.6 Домен

**Домен: `parking31a.com`.**

1. Зона `parking31a.com` додається в Cloudflare-акаунт замовника (доступ надає замовник); nameservers у реєстратора → статус Active. (Якщо домен ще не зареєстровано — Cloudflare Registrar реєструє at-cost, зона створюється автоматично.)
2. Workers → Settings → Domains & Routes → Custom Domain: `parking31a.com` (apex) + `www.parking31a.com` з редіректом на apex — DNS і TLS автоматично.
3. Вимкнути `workers.dev`-маршрут production-Worker. SSL/TLS: Full (Strict) + Always Use HTTPS.

### 4.7 Вартість

Усе в межах Free tier (Workers 100k зап./день, D1 5 ГБ, R2 10 ГБ — наше навантаження на порядки менше). **Хостинг: 0 грн/міс.** Витрата — домен (~$10–15/рік). Workers Paid ($5/міс) не потрібен (Time Travel 30 діб компенсується R2-дампами).

### 4.8 Чекліст першого деплою

1. Отримати доступ до Cloudflare-акаунта замовника; додати `parking31a.com` як зону (або зареєструвати через Cloudflare Registrar); nameservers → Active.
2. Node 22+, клон репо, `npm ci`, `npx wrangler login`.
3. `wrangler d1 create parking-db` → `wrangler r2 bucket create parking-backups` → id у `wrangler.jsonc`.
4. Міграції локально + `npm run dev` — перевірка на тестових даних.
5. `wrangler d1 migrations apply parking-db --remote`.
6. `wrangler secret put TOTP_ENC_KEY` (32 випадкові байти base64).
7. `npm run build && npx wrangler deploy` → перевірка на `*.workers.dev`.
8. Прив'язати `parking31a.com` (4.6); перевірити HTTPS.
9. `npm run create-admin -- --email "…"` → QR для Google Authenticator.
10. Увійти: email + пароль + TOTP — переконатися, що 2ФА працює.
11. GitHub Secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) → тестовий push у `main` → Actions-деплой пройшов.
12. R2 lifecycle (>180 діб — видаляти); наступного ранку перевірити `backups/parking-<дата>.sql.gz`.
13. Вимкнути workers.dev; фінальний smoke-test: мапа, картка, проєкт, мультивибір, оплата, бекап.

---

## 5. UX-специфікація

### 5.0 Каркас

- **App shell:** верхня панель — назва («Паркінг Правди 31»), глобальний пошук, меню користувача. Навігація: **Мапа · Проєкти · Власники · Налаштування**.
- Маршрути: `/login`, `/login/2fa`, `/login/setup-2fa`, `/` (мапа), `/spots/:n`, `/projects`, `/projects/:id`, `/owners`, `/owners/:id`, `/settings/{users|security|audit|import}`.
- Збереження — негайне на сервер; без мережі (підземний паркінг!) — липкий банер «Немає з'єднання — зміни не збережено» + «Повторити». Offline-режиму у v1 немає.

### 5.1 Автентифікація

- **`/login`:** Email + Пароль, «Увійти». Помилка — єдина: «Невірний email або пароль». Після 5 невдач — таймер блокування.  Без «забули пароль» (скидання — іншим адміном; break-glass — розд. 3.7).
- **`/login/2fa`:** поле на 6 цифр (autofocus, вставка з буфера, автосабміт), «Використати резервний код». 5 невдалих кодів → назад на `/login`. *«Довіряти пристрою 30 днів» у v1 НЕ реалізується* (послаблює 2ФА; розд. 8, п.5).
- **`/login/setup-2fa`** (перший вхід, обов'язково): 1) зміна тимчасового пароля (мін. 12 симв.); 2) QR + секрет текстом; 3) підтвердження кодом; 4) **10 резервних кодів** («Копіювати», «Завантажити .txt», чекбокс «Я зберіг…» → «Завершити»).

### 5.2 Dashboard — мапа (`/`)

- **Статистика** (клікабельні плитки → фільтр/підсвітка): Всього · Зайнято · Вільно · З боргом · Активних проєктів. «З боргом» = несплачені частки в **активних** проєктах (несплачені частки завершених — видимі в картках/сторінці власника як «Не сплачено (завершений)»; розд. 8, п.4).
- **Таби рівнів:** «Секція А, Б» (№1–88) і «Секція В, Г» (№89–181), лічильники зайнято/всього, стан у URL `?level=`.
- **Мапа:** адаптований SVG з reference-схеми; zoom/pan (колесо/drag, кнопки +/−/1:1).
- **Візуальне кодування:**
  - *Первинне (заливка):* Вільне — світле; Зайняте — акцентно-синє з білим номером. Тільки 2 стани.
  - *Вторинне:* червоний бейдж ● у куті = несплачена частка в активному проєкті.
  - *Взаємодія:* hover — товстіший контур; обране — акцентний контур+тінь; знайдене пошуком — пульсація 2 с.
  - *Проєктний шар:* dropdown «Шар: Зайнятість ▾ / Проєкт "…"». У шарі проєкту: сірий = не учасник, жовтогарячий = не сплатив, зелений = сплатив. Банер «Шар проєкту — [Повернутись]».

### 5.3 Картка місця (drawer, `/spots/:n`)

Правий drawer 420 px поверх мапи; закриття ✕/Esc/клік по фону; deep-link працює.

1. **Шапка:** «Місце №12 · Секція А» + чип (Вільне/Зайняте) + бейдж «Борг: 2 500,00 грн». Кнопки: «Редагувати», меню ⋯: «Копіювати дані», «Показати на мапі», **«Змінити власника»** (закриває чинний запис історії, створює новий — для продажу місця), **«Виправити дані власника»** (правка сутності owner — зачепить усі його місця; для одруків), «Очистити місце» (з підтвердженням).
2. **Власник:** ПІП; телефон (`tel:`); номерний знак (моно, великими); марка/модель; співвласник (якщо є). «Всі місця власника →» (якщо >1). Вкладка **«Історія власників»** — попередні з періодами.
3. **Участь у проєктах** — таблиця: Проєкт · Частка · Статус (Сплачено ✓ / Не сплачено / Доплата X грн / Не сплачено (завершений)) · Дата. Дія «Позначити сплаченим» (popover: дата=сьогодні, спосіб: готівка/переказ/інше, коментар). «Додати до проєкту…».
4. **Нотатки** (нові зверху): ручні (картка, дата+автор, редагувати/видалити) та **авто-нотатки** (сіра картка з синьою смугою і 📌, нередагована, лінк на проєкт; текст — формат розд. 2.6).

### 5.4 Мультивибір на мапі

- Клік = картка; **Ctrl/Cmd+клік** = перемкнути вибір (входить у режим вибору); **drag по порожньому** = прямокутний вибір (Ctrl+drag — додає); **Esc** = зняти все. У режимі вибору звичайний клік теж перемикає.
- **Панель вибору** (замість drawer): «Обрано: 14 місць» + таблиця № · ПІП · Телефон · Авто · Борг (вільні — «— вільне»).
- **Групові дії:** «Копіювати» (TSV у буфер); «Експорт CSV» (`spots_YYYY-MM-DD.csv`, UTF-8 **з BOM** для Excel); «Додати до проєкту» (модал: активні проєкти або «+ Новий»); «Позначити оплату» (спільний проєкт → дата → підтвердити N місць).

### 5.5 Проєкти

- **`/projects`:** «+ Новий проєкт» (модал: назва, опис, вартість → створюється як **чернетка**). Список: Назва · Статус-чип (**Чернетка** — сірий контур / **Активний** — синій / **Завершений** — сірий / **Архів** / **Скасований**) · Вартість · Учасників · Частка · Прогрес оплат. Фільтри: Всі / Чернетки / Активні / Завершені / Архів.
- **`/projects/:id`:**
  - Шапка: назва, статус, дії за станом (розд. 2.5): «Активувати» (чернетка), «Завершити проєкт», «Скасувати проєкт», «Архівувати», ⋯ → «Видалити» (**тільки чернетка**; інакше неактивно з поясненням).
  - Розрахунок: «120 000,00 грн ÷ 48 = 2 500,00 грн/місце» + ⓘ про розподіл копійок (розд. 2.3).
  - Прогрес-бар: «Зібрано 110 000,00 з 120 000,00 грн · 44/48».
  - Учасники: № (лінк) · Власник · Частка · Статус · Дата · Дії («Позначити сплаченим» / **«Скасувати оплату» (модал з обов'язковим полем «Причина»)** / «Прибрати з проєкту» — неактивно для сплачених з підказкою).
  - Перерахунок: миттєвий для всіх, тост «Частку перераховано: 2 500,00 → 2 380,00 грн»; сплачені показують переплату/доплату (розд. 2.4).
  - «Додати/прибрати місця» → повноекранний **map-picker** (мапа в режимі вибору, учасники підсвічені, сплачені — 🔒). Футер: «Обрано 48 · частка 2 500,00 грн» + Зберегти/Скасувати.
  - **Експорт:** «Експорт учасників CSV» + «Список боржників (друк)» — проста друкована сторінка для оголошення на дошку.
- **Завершення:** модал-підсумок «Сплатили: 44 місця — 110 000,00 грн. Не сплатили: 4: №12 (Іваненко), … На картки місць, що сплатили, буде додано автонотатку.» → статус Завершений (read-only) + «Повернути в активні» (з підтвердженням; автонотатки видаляються).

### 5.6 Власники

- **`/owners`:** таблиця ПІП · Телефон · Місця (чипи «№12 №13» → мапа) · Авто · Борг. Пошук, сортування за ПІП/боргом. Створення — тільки через картку місця або імпорт.
- **`/owners/:id`:** контакти («Редагувати» → застосовується до всіх місць), картки місць, **історія проєктів по всіх місцях** (включно із завершеними; несплачені завершені — видимі). Підсумок: «Участь у 3 проєктах · сплачено 7 500,00 грн · борг 2 380,00 грн».

### 5.7 Глобальний пошук

Hotkey `/` або Ctrl+K. Групи: Місця (за №), Власники (ПІП, частковий збіг), Авто (**нормалізація кирилиця↔латиниця** А/A В/B С/C Е/E І/I К/K М/M Н/H О/O Р/P Т/T Х/X + ігнор пробілів), Телефони (тільки цифри), Проєкти. Enter: місце → мапа з drawer і автоперемиканням рівня.

### 5.8 Налаштування

1. **Користувачі:** email, роль, стан 2ФА, останній вхід, стан. «+ Додати адміністратора» (email + тимчасовий пароль, показується раз). Дії: «Скинути пароль» (новий тимчасовий + скидання 2ФА), «Деактивувати». Не можна деактивувати себе/останнього адміна.
2. **Безпека:** зміна пароля; «Переналаштувати 2ФА» (пароль + чинний TOTP → новий QR); «Згенерувати нові резервні коди»; список активних сесій + «Вийти всюди».
3. **Журнал дій:** read-only таблиця (Дата · Користувач · Дія · Об'єкт · Деталі), фільтри: користувач/тип/період.
4. **Імпорт** — розд. 5.10.

### 5.9 Мобільний режим (<768 px) — першокласний (адмін працює з телефона в гаражі)

- Нижній tab-bar: Мапа · Пошук · Проєкти · Ще.
- Мапа: pinch-zoom/pan; таби — segmented control; статистика — стрічка чипів. Ціль дотику ≥40 px (через зум).
- Картка — bottom sheet на весь екран; телефон — велика кнопка «Подзвонити».
- Мультивибір: кнопка «Вибрати» вмикає режим (Ctrl немає); панель — згорнутий рядок «Обрано: 14 · [Дії]».
- Таблиці → стек карток; модали — на весь екран.

### 5.10 Первинний імпорт — *опційно (v1.1)*

> Замовник підтвердив (09.07.2026): готової таблиці власників немає, дані вносяться **вручну через картки місць**. Екран імпорту не блокує запуск — реалізується за наявності часу або у v1.1. Специфікація нижче зберігається на майбутнє.

- **Крок 1:** CSV/XLSX drag&drop + «Завантажити шаблон (XLSX)». Колонки: `номер_місця`* · `піб`* · `телефон` · `номер_авто` · `марка_модель` · `нотатка`. (Секція не потрібна — сідиться міграцією.) **XLSX парситься на клієнті (SheetJS); на Worker іде вже JSON.**
- **Крок 2 — dry-run:** ✓ Нове / ↻ Оновлення (з diff «було→стане») / ✗ Помилка (неіснуючий №, дубль у файлі, порожнє ПІП, нерозпізнаний телефон). Підсумок «167 нових · 3 оновлення · 2 помилки»; чекбокс «Імпортувати лише валідні рядки».
- **Крок 3:** застосування; **злиття власників за телефоном** (рядки без телефону створюють окремих власників — попередження в dry-run; ручне «Об'єднати власників» — беклог v1.1); тост-звіт; запис у журнал. Повторний імпорт того ж файлу — безпечний (без дублів).

### 5.11 Глосарій UI

| Контекст | Текст |
|---|---|
| Загальні | Зберегти · Скасувати · Редагувати · Видалити · Копіювати · Експорт CSV · Закрити |
| Вхід | Увійти · Вийти · Пароль · Код підтвердження · Використати резервний код |
| Мапа | Вибрати · Зняти виділення · Обрано: N місць · Показати на мапі · Шар: Зайнятість / Проєкт |
| Статуси місця | Вільне · Зайняте |
| Статуси оплати | Сплачено · Не сплачено · Доплата X грн · Не сплачено (завершений) |
| Статуси проєкту | Чернетка · Активний · Завершений · Архів · Скасований |
| Проєкти | + Новий проєкт · Активувати · Додати до проєкту · Прибрати з проєкту · Позначити сплаченим · Скасувати оплату · Завершити проєкт · Повернути в активні · Частка · Зібрано X з Y грн |
| Підтвердження | «Завершити проєкт "…"? Сплатили: N (X грн). Не сплатили: M: … На картки місць, що сплатили, буде додано автоматичну нотатку.» · «Прибрати місце №12 з проєкту? Частку інших буде перераховано.» · «Очистити місце №12? Дані власника буде видалено з картки, нотатки збережуться.» |
| Помилки | Невірний email або пароль · Забагато спроб — зачекайте 15 хв · Немає з'єднання — зміни не збережено |

---

## 6. API (ескіз)

`/api/auth/login` · `/api/auth/totp` · `/api/auth/logout` · `/api/auth/sessions` — автентифікація (двофазна).
`/api/spots` (GET список із власниками/боргами) · `/api/spots/:id` (GET/PATCH) · `/api/spots/:id/owner` (PUT зміна власника, POST співвласник, DELETE очистити) · `/api/spots/:id/notes` (GET/POST).
`/api/owners` · `/api/owners/:id` (GET/PATCH) · `/api/owners/:id/history`.
`/api/projects` (GET/POST) · `/api/projects/:id` (GET/PATCH/DELETE-draft) · `/api/projects/:id/status` (POST перехід) · `/api/projects/:id/spots` (PUT склад → перерахунок) · `/api/projects/:id/payments` (POST відмітити [bulk], DELETE скасувати з причиною).
`/api/search?q=` · `/api/import/dry-run` · `/api/import/apply` · `/api/audit` · `/api/users` (+/:id, reset-password, reset-2fa).
Валідація — zod; усі відповіді — JSON; помилки `{error: {code, message}}`.

---

## 7. План реалізації (для сесії Opus 4.8)

| Етап | Зміст | Критерій готовності |
|---|---|---|
| **0. Каркас** | Repo, Vite+React+TS, Hono, wrangler.jsonc, Drizzle, CI-скелет | `npm run dev` віддає SPA + `/api/health` |
| **1. БД** | Міграція 0001 (весь DDL), seed 180 місць + тестові дані | `wrangler d1 migrations apply --local` чистий |
| **2. Auth** | PBKDF2, TOTP (otpauth), сесії D1, двофазний вхід, enrollment, lockout, create-admin скрипт | Повний цикл входу з Google Authenticator локально |
| **3. Мапа + картки** | Адаптація SVG-модуля, drawer картки, власники CRUD, нотатки, історія власників | Клік по місцю → картка → редагування зберігається |
| **4. Проєкти** | CRUD, state machine, перерахунок часток, оплати (+bulk), автонотатки, map-picker | Юніт-тести recalcShares + переходів статусів зелені |
| **5. Мультивибір + пошук** | Selection-панель, CSV/TSV експорт, глобальний пошук з нормалізацією | Вибір 10 місць → CSV відкривається в Excel з коректною кирилицею |
| **6. Сервіс** | Audit UI, налаштування користувачів, cron-бекап, мобільний режим, security-заголовки | Smoke-test чекліста 4.8 |
| **7. Деплой** | Cloudflare-ресурси, parking31a.com, секрети, GitHub Actions, перший адмін | Сайт на домені, вхід з 2ФА, бекап у R2 |
| *(v1.1, опційно)* | Екран імпорту з dry-run (розд. 5.10), «Об'єднати власників» | Імпорт шаблону з помилками показує їх у dry-run |

**Тестування:** юніт — `recalcShares` (округлення, детермінізм), переходи статусів, TOTP anti-replay; інтеграційні — оплата→перерахунок→дельти, завершення→автонотатки→розвершення (ідемпотентність); ручний smoke — чекліст 4.8 п.13.

---

## 8. Рішення замовника та відкриті питання

### Закрито 09.07.2026

| Питання | Рішення замовника |
|---|---|
| Місце №89 | **Існує** — сід створює 181 місце (№1–181); позицію на мапі звірити візуально |
| Звірка схеми v1 | **Підтверджено** — розподіл номерів по рядах/секціях вірний |
| Щомісячні внески | **У v1 не потрібні**, але можливі в майбутньому → див. «Кандидати на v2» |
| Домен | **parking31a.com**, Cloudflare-акаунт замовника (доступи надасть) |
| Дані власників | Готової таблиці немає — **вносяться вручну** через картки; імпорт → v1.1 |

### Залишається уточнити (не блокує реалізацію — діють рекомендації специфікації)

1. **Email-адреси адміністраторів** — перелік для створення акаунтів (потрібно на етапі 7, деплой).
2. **Борг по завершених проєктах** — за замовчуванням дашборд рахує лише активні; несплачені завершені видимі в картках/у власника.
3. **«Довіряти пристрою 30 днів»** — за замовчуванням не робимо (сесія і так живе 7–30 діб).
4. **Зміна власника посеред проєкту** — за замовчуванням борг успадковується місцем.
5. **Чи зареєстровано parking31a.com** — якщо ні, реєструємо через Cloudflare Registrar (at-cost, ~$10/рік).

### Кандидати на v2

- **Щомісячні/регулярні внески.** Шлях розширення без зміни схеми БД: періодичні авто-проєкти («Експлуатаційний внесок · липень 2026») з шаблоном, який щомісяця створює новий проєкт на всі місця. Уся механіка часток/оплат/боргів перевикористовується як є.
- Імпорт з таблиці (розд. 5.10) + інструмент «Об'єднати власників».
- Роль `viewer` (read-only) — поле в БД уже зарезервоване.
- Нагадування боржникам (експорт списку → Viber/SMS вручну; автоматизація — окрема розмова).
