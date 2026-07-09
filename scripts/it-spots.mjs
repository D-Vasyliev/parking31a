// Інтеграційний тест API місць/власників/нотаток проти запущеного dev-сервера.
// Запуск: node scripts/it-spots.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import * as OTPAuth from "otpauth";

const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "it-spots@parking31a.com";
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
function absorb(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const sc of list) {
    const [pair, ...attrs] = sc.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === "") jar.delete(name);
    else jar.set(name, value);
  }
}
async function req(method, path, body) {
  const headers = {};
  const c = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers["Cookie"] = c;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(res);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* */
  }
  return { status: res.status, json };
}
function totp(secret, offset = 0) {
  const t = new OTPAuth.TOTP({ issuer: "Parking31a", label: "x", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  return t.generate({ timestamp: Date.now() + offset });
}

async function authenticate() {
  wrangler(`DELETE FROM users WHERE email='${EMAIL}'`);
  wrangler(`DELETE FROM notes; DELETE FROM spot_owners; DELETE FROM owners;`);
  execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP_PW], { stdio: "pipe" });
  await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP_PW });
  await req("POST", "/api/auth/enroll/password", { newPassword: NEW_PW });
  const s = await req("POST", "/api/auth/enroll/totp/start");
  const r = await req("POST", "/api/auth/enroll/totp/confirm", { code: totp(s.json.secret) });
  if (r.status !== 200) throw new Error("authenticate failed: " + r.status);
}

async function main() {
  console.log(`Інтеграційний тест spots/owners/notes → ${BASE}`);
  console.log("\n[auth]");
  await authenticate();
  ok(jar.has("__Host-session"), "автентифіковано (сесія)");

  console.log("\n[spots list]");
  let r = await req("GET", "/api/spots");
  ok(r.status === 200 && Array.isArray(r.json) && r.json.length === 181, "GET /api/spots → 181 місць");
  ok(r.json.every((s) => s.occupied === false), "усі місця вільні (після reset)");

  console.log("\n[spot detail + owner]");
  r = await req("GET", "/api/spots/42");
  ok(r.status === 200 && r.json.number === 42 && r.json.owners.length === 0, "деталі №42 без власника");
  r = await req("PUT", "/api/spots/42/owner", { fullName: "Іваненко Іван", phone: "+380671112233" });
  ok(r.status === 200 && r.json.owners.length === 1 && r.json.owners[0].isPrimary, "призначено основного власника");
  r = await req("GET", "/api/spots");
  const s42 = r.json.find((s) => s.number === 42);
  ok(s42.occupied === true && s42.ownerName === "Іваненко Іван", "у списку №42 зайняте + ПІП");

  console.log("\n[car]");
  r = await req("PATCH", "/api/spots/42", { plate: "AA1234BB", carMake: "Toyota", carModel: "RAV4" });
  ok(r.status === 200 && r.json.plate === "AA1234BB" && r.json.carMake === "Toyota", "оновлено дані авто");

  console.log("\n[coowner]");
  r = await req("POST", "/api/spots/42/coowner", { fullName: "Петренко Петро" });
  ok(r.status === 200 && r.json.owners.length === 2, "додано співвласника");

  console.log("\n[notes]");
  r = await req("POST", "/api/spots/42/notes", { body: "Ключ у охорони" });
  ok(r.status === 200 && r.json.notes.length === 1, "додано нотатку");
  const noteId = r.json.notes[0].id;
  r = await req("PATCH", `/api/notes/${noteId}`, { body: "Оновлена нотатка" });
  ok(r.status === 200, "редаговано нотатку");
  r = await req("GET", "/api/spots/42");
  ok(r.json.notes[0].body === "Оновлена нотатка", "нотатку оновлено у деталях");
  r = await req("DELETE", `/api/notes/${noteId}`);
  ok(r.status === 200, "видалено нотатку");
  r = await req("GET", "/api/spots/42");
  ok(r.json.notes.length === 0, "нотаток немає");

  console.log("\n[change owner → history]");
  r = await req("PUT", "/api/spots/42/owner", { fullName: "Сидоренко Сидір", phone: "+380509998877" });
  ok(r.status === 200 && r.json.owners.find((o) => o.isPrimary).fullName === "Сидоренко Сидір", "змінено власника");
  ok(r.json.history.length >= 2, "історія містить попереднього власника");

  console.log("\n[owners directory]");
  r = await req("GET", "/api/owners");
  ok(r.status === 200 && r.json.some((o) => o.fullName === "Сидоренко Сидір" && o.spots.includes(42)), "власник у довіднику з місцем 42");

  console.log("\n[clear spot]");
  r = await req("DELETE", "/api/spots/42/owners");
  ok(r.status === 200 && r.json.owners.length === 0, "місце очищено");
  r = await req("GET", "/api/spots");
  ok(r.json.find((s) => s.number === 42).occupied === false, "№42 знову вільне");

  console.log("\n[auth guard]");
  jar.clear();
  r = await req("GET", "/api/spots");
  ok(r.status === 401, "без сесії GET /api/spots → 401");

  console.log(`\n✅ Усі перевірки пройдено: ${passed}`);
}

main().catch((e) => {
  console.error("\n❌ " + e.message);
  process.exit(1);
});
