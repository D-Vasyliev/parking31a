# Деплой parking31a на Cloudflare

Домен: **parking31a.com** · один Cloudflare Worker (API + SPA) + D1 + R2.
Deploy-команду перевірено локально (`wrangler deploy --dry-run` ✓).

> Усі кроки виконуються в Cloudflare-акаунті замовника. Потрібні: доступ до акаунта
> (`wrangler login` або API-токен), Node.js 22+, клон репозиторію.

## 1. Автентифікація

Варіант А (інтерактивно):

```bash
npx wrangler login
```

Варіант Б (токен, напр. для CI/безголового запуску): створити API-токен у Cloudflare
(шаблон **Edit Cloudflare Workers** + дозволи **D1:Edit**, **Workers R2 Storage:Edit**), тоді:

```bash
export CLOUDFLARE_API_TOKEN=...        # Windows PowerShell: $env:CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID=...
```

## 2. Створити ресурси

```bash
npx wrangler d1 create parking-db
# → скопіювати виданий database_id у wrangler.jsonc: d1_databases[0].database_id
#    (замінити плейсхолдер 00000000-... ) і закомітити+запушити

npx wrangler r2 bucket create parking31a-backups
```

## 3. Секрет шифрування TOTP

Згенерувати 32-байтовий ключ (НЕ комітити, показати лише собі) і задати як секрет:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put TOTP_ENC_KEY        # вставити згенерований ключ
```

> Ключ зберігати в менеджері паролів. Втрата ключа = неможливість розшифрувати
> TOTP-секрети (усім доведеться переналаштувати 2ФА через break-glass).

## 4. Міграції у production D1

```bash
npm run db:migrate:remote        # wrangler d1 migrations apply parking-db --remote
```

Створює 10 таблиць і сідить **181 місце**.

## 5. Перший деплой

```bash
npm run deploy                   # vite build && wrangler deploy
```

Перевірити тимчасовий `*.workers.dev` URL: `GET /api/health` → `{"ok":true,...}`.

## 6. Домен

Cloudflare Dashboard → **Workers & Pages → parking31a → Settings → Domains & Routes**:

1. **Add → Custom Domain** → `parking31a.com` (і `www.parking31a.com` з редіректом на apex).
   DNS і TLS-сертифікат Cloudflare створює автоматично.
2. **Вимкнути** маршрут `*.workers.dev` для production-воркера.
3. SSL/TLS → режим **Full (Strict)**, увімкнути **Always Use HTTPS**.

Якщо `parking31a.com` ще не в Cloudflare — спершу додати зону (Add a domain) і змінити
nameservers у реєстратора, або зареєструвати через Cloudflare Registrar.

## 7. Перший адміністратор

```bash
node scripts/create-admin.mjs --email admin@parking31a.com --remote
# виведе тимчасовий пароль
```

Відкрити сайт → увійти (email + тимчасовий пароль) → майстер: зміна пароля + сканування
QR у Google Authenticator + збереження резервних кодів. Далі додавати інших адмінів у
**Налаштування → Користувачі**.

## 8. Бекапи

- Cron уже налаштований (`"0 1 * * *"`, ~03:00 Києва): щоніч SQL-дамп D1 → R2
  (`backups/parking-YYYY-MM-DD.sql.gz`) + очистка протухлих сесій.
- Разово перевірити: увійти адміном і `POST /api/backup`, тоді
  `npx wrangler r2 object get parking31a-backups/backups/parking-<дата>.sql.gz --file=b.gz`.
- **R2 lifecycle**: у налаштуваннях бакета додати правило «видаляти обʼєкти `backups/`
  старші за 180 днів».
- **Відновлення** (нова D1): `npm run db:migrate:remote` → розпакувати дамп →
  `npx wrangler d1 execute parking-db --remote --file=dump.sql`
  (дамп ідемпотентний: DELETE + INSERT OR REPLACE). Раз на квартал — тестове відновлення.

## 9. Автодеплой (Cloudflare Workers Builds)

Репозиторій під'єднано до Workers Builds. Налаштування збірки в дашборді:

- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- Для змін схеми БД перед деплоєм застосувати міграції:
  `npx wrangler d1 migrations apply parking-db --remote`
  (або додати цей крок у Deploy command перед `wrangler deploy`).

Пуш у `main` → автоматична збірка й деплой. GitHub Actions (`.github/workflows/ci.yml`)
виконує лише перевірки (typecheck + тести + білд), без деплою.

## Аварійні процедури

**Втрата 2ФА-пристрою (єдиний адмін):**

```bash
npx wrangler d1 execute parking-db --remote \
  --command "UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE email='admin@parking31a.com'"
```

Наступний вхід вимагатиме повторного enrollment 2ФА.

**Скидання блокування акаунта (lockout):**

```bash
npx wrangler d1 execute parking-db --remote \
  --command "UPDATE users SET failed_logins=0, locked_until=NULL WHERE email='...'"
```
