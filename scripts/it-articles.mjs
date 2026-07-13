// Інтеграційний тест «Технічна інформація» проти запущеного dev-сервера.
// Передумови: `npm run dev` і застосовані міграції (--local, включно з 0004).
// Запуск: node scripts/it-articles.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import * as OTPAuth from "otpauth";

const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "it-articles@parking31a.com";
const TEMP_PW = "TempPassw0rd!!";
const NEW_PW = "NewStr0ngPass!234";
const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("ПРОВАЛ: " + msg);
  passed++;
  console.log("  ✓ " + msg);
}
function wrangler(sql) {
  execFileSync(process.execPath, [wranglerBin, "d1", "execute", "parking-db", "--local", "--command", sql], { stdio: "pipe" });
}

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const sc of list) {
    const [pair, ...attrs] = sc.split(";");
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === "") jar.delete(name);
    else jar.set(name, value);
  }
}
async function req(method, path, body) {
  const headers = {};
  const c = cookieHeader();
  if (c) headers["Cookie"] = c;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(res);
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
function totpCode(base32, offsetMs = 0) {
  const t = new OTPAuth.TOTP({ issuer: "Parking31a", label: "x", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(base32) });
  return t.generate({ timestamp: Date.now() + offsetMs });
}

async function main() {
  console.log(`Інтеграційний тест articles → ${BASE}`);
  console.log("\n[setup]");
  wrangler(`DELETE FROM tech_articles`);
  wrangler(`DELETE FROM users WHERE email='${EMAIL}'`);
  execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP_PW], { stdio: "pipe" });

  console.log("\n[auth: без сесії]");
  ok((await req("GET", "/api/articles")).status === 401, "GET /api/articles без входу → 401");
  ok((await req("POST", "/api/articles", { title: "x" })).status === 401, "POST без входу → 401");

  console.log("\n[login + enroll]");
  let r = await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP_PW });
  ok(r.status === 200 && r.json.next === "enroll", "login → enroll");
  ok((await req("POST", "/api/auth/enroll/password", { newPassword: NEW_PW })).status === 200, "зміна пароля");
  r = await req("POST", "/api/auth/enroll/totp/start");
  const secret = r.json.secret;
  ok((await req("POST", "/api/auth/enroll/totp/confirm", { code: totpCode(secret) })).status === 200, "2ФА підтверджено (є сесія)");

  console.log("\n[CRUD]");
  ok(JSON.stringify((await req("GET", "/api/articles")).json) === "[]", "порожній список → []");

  r = await req("POST", "/api/articles", { title: "Шлагбаум", body: "Код 1234.\nДзвінок: 067..." });
  ok(r.status === 201 && typeof r.json.id === "number", "створення → 201 + id");
  const id = r.json.id;

  ok((await req("POST", "/api/articles", { title: "   " })).status === 400, "порожній заголовок → 400");

  r = await req("GET", "/api/articles");
  ok(r.status === 200 && r.json.length === 1, "список → 1 стаття");
  ok(r.json[0].title === "Шлагбаум" && r.json[0].body.includes("\n"), "заголовок + багаторядковий опис збережено");
  ok(r.json[0].updatedByEmail === EMAIL, "updatedByEmail = автор");

  ok((await req("PATCH", `/api/articles/${id}`, { title: "Шлагбаум (оновлено)", body: "Новий код 5678." })).status === 200, "редагування → 200");
  r = await req("GET", "/api/articles");
  ok(r.json[0].title === "Шлагбаум (оновлено)" && r.json[0].body === "Новий код 5678.", "зміни збережено");

  ok((await req("PATCH", `/api/articles/99999`, { title: "нема" })).status === 404, "PATCH неіснуючої → 404");
  ok((await req("DELETE", `/api/articles/${id}`)).status === 200, "видалення → 200");
  ok((await req("GET", "/api/articles")).json.length === 0, "список порожній після видалення");
  ok((await req("DELETE", `/api/articles/${id}`)).status === 404, "повторне видалення → 404");

  console.log(`\n✅ Усі перевірки пройдено: ${passed}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
