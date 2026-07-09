# parking31a — система керування паркінгом

Веб-застосунок для керування підземним паркінгом ЖК на пр. Правди 31-33 / 31-А (Київ):
картки машиномісць із даними власників, колективні «проєкти» з поділом вартості,
інтерактивна мапа, доступ через логін + пароль + 2ФА.

Повна специфікація: [`docs/SPEC.md`](docs/SPEC.md).

## Стек

- **Cloudflare Worker** (один): Static Assets (SPA) + [Hono](https://hono.dev) API
- **Vite + React 19 + TypeScript** ([@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/vite-plugin/))
- **Cloudflare D1** (SQLite) + **Drizzle ORM** (міграції — SQL через `wrangler d1 migrations`)
- **R2** — нічні бекапи · **2ФА** — пароль (PBKDF2) + TOTP

## Швидкий старт

Потрібен Node.js 22+.

```bash
npm install
cp .dev.vars.example .dev.vars      # локальні секрети (у .gitignore)
npm run db:migrate:local            # застосувати міграції у локальну D1 (після етапу 1)
npm run dev                         # http://localhost:5173  → SPA + /api/*
```

Перевірка API: `GET /api/health` → `{ "ok": true, "service": "parking31a", ... }`.

## Скрипти

| Команда | Дія |
|---|---|
| `npm run dev` | Локальний сервер (Worker у workerd + Vite HMR) |
| `npm run build` | Продакшн-білд (SPA + Worker) |
| `npm run preview` | Перегляд білду у workerd |
| `npm run typecheck` | Перевірка типів (worker + client окремо) |
| `npm test` | Юніт-тести (Vitest) |
| `npm run db:seed:gen` | Перегенерувати сід місць (0002) зі spot-ranges.json |
| `npm run db:migrate:local` / `:remote` | Застосувати міграції D1 |
| `npm run cf-typegen` | Згенерувати типи прив'язок з `wrangler.jsonc` |
| `npm run deploy` | Білд + `wrangler deploy` (зазвичай робить CI) |

## Структура

```
src/
  worker/    # Hono API, auth, БД (Drizzle), cron
  client/    # React SPA (мапа, картки, проєкти)
  shared/    # спільні типи/константи
migrations/  # SQL-міграції D1
docs/SPEC.md # специфікація
reference/   # інтерактивна SVG-схема паркінгу (прототип мапи)
```

## Деплой

Репозиторій під'єднано до **Cloudflare Workers Builds** (git-інтеграція):
пуш у `main` → CF виконує `npm run build` і `npx wrangler deploy`.

Разові кроки при першому налаштуванні (див. `docs/SPEC.md` §4.8):
`wrangler d1 create parking-db` → вписати `database_id` у `wrangler.jsonc` →
`wrangler secret put TOTP_ENC_KEY` → прив'язати домен `parking31a.com`.
Міграції у прод: `npm run db:migrate:remote` (перед деплоєм нового коду).

GitHub Actions (`.github/workflows/ci.yml`) виконує лише перевірки
(typecheck + тести + білд), без деплою.

## Статус реалізації

- [x] **Етап 0** — каркас (Vite+React+Hono+Drizzle+wrangler, `/api/health`)
- [x] **Етап 1** — БД: схема (Drizzle), міграції 0001+0002, seed 181 місце
- [x] **Етап 2** — автентифікація (пароль + TOTP 2ФА, сесії D1, enrollment, lockout)
- [ ] Етап 3 — мапа + картки місць/власників
- [ ] Етап 4 — проєкти (поділ вартості, оплати, автонотатки)
- [ ] Етап 5 — мультивибір, пошук
- [ ] Етап 6 — аудит, користувачі, cron-бекап, мобільний режим
- [ ] Етап 7 — деплой на `parking31a.com`
