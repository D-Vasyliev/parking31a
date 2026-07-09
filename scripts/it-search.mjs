// Інтеграційний тест глобального пошуку. Запуск: node scripts/it-search.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import * as OTPAuth from "otpauth";

const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "it-search@parking31a.com";
const TEMP = "TempPassw0rd!!";
const NEW = "NewStr0ngPass!234";
const wr = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
let passed = 0;
function ok(c, m) {
  if (!c) throw new Error("ПРОВАЛ: " + m);
  passed++;
  console.log("  ✓ " + m);
}
function wrangler(sql) {
  execFileSync(process.execPath, [wr, "d1", "execute", "parking-db", "--local", "--command", sql], { stdio: "pipe" });
}
const jar = new Map();
function absorb(res) {
  for (const sc of res.headers.getSetCookie?.() || []) {
    const [p, ...a] = sc.split(";");
    const i = p.indexOf("=");
    const n = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (a.some((x) => /max-age=0\b/i.test(x)) || v === "") jar.delete(n);
    else jar.set(n, v);
  }
}
async function req(m, path, body) {
  const h = {};
  const c = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) h.Cookie = c;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method: m, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(res);
  let j = null;
  try {
    j = await res.json();
  } catch {
    /* */
  }
  return { status: res.status, json: j };
}
function code(s) {
  return new OTPAuth.TOTP({ issuer: "Parking31a", label: "x", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(s) }).generate();
}
async function auth() {
  wrangler(`DELETE FROM users WHERE email='${EMAIL}'`);
  wrangler(`DELETE FROM notes; DELETE FROM project_spots; DELETE FROM projects; DELETE FROM spot_owners; DELETE FROM owners; UPDATE spots SET plate=NULL, car_make=NULL, car_model=NULL;`);
  execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP], { stdio: "pipe" });
  await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP });
  await req("POST", "/api/auth/enroll/password", { newPassword: NEW });
  const s = await req("POST", "/api/auth/enroll/totp/start");
  await req("POST", "/api/auth/enroll/totp/confirm", { code: code(s.json.secret) });
}
const S = (path) => req("GET", "/api/search?q=" + encodeURIComponent(path));

async function main() {
  console.log(`Інтеграційний тест пошуку → ${BASE}`);
  console.log("\n[setup]");
  await auth();
  await req("PUT", "/api/spots/55/owner", { fullName: "Коваленко Марія", phone: "+380671234567" });
  await req("PATCH", "/api/spots/55", { plate: "АА1234ВК" }); // кирилиця
  await req("POST", "/api/projects", { title: "Відеонагляд під'їзду", totalKop: 100000 });
  ok(true, "дані підготовлено");

  console.log("\n[пошук]");
  let r = await S("55");
  ok(r.status === 200 && r.json.spots.some((s) => s.number === 55), "за номером 55 → місце знайдено");
  r = await S("Коваленко");
  ok(r.json.owners.some((o) => o.fullName === "Коваленко Марія"), "за ПІП → власника знайдено");
  r = await S("1234567");
  ok(r.json.owners.some((o) => o.fullName === "Коваленко Марія"), "за цифрами телефону → власника знайдено");
  r = await S("AA1234BK"); // латиниця проти кириличного номера
  ok(r.json.spots.some((s) => s.number === 55), "за авто латиницею → місце з кириличним номером (нормалізація)");
  r = await S("відео");
  ok(r.json.projects.some((p) => p.title.includes("Відеонагляд")), "за назвою → проєкт знайдено");
  r = await S("zzznomatch");
  ok(r.json.spots.length === 0 && r.json.owners.length === 0 && r.json.projects.length === 0, "неіснуючий запит → порожньо");

  console.log("\n[guard]");
  jar.clear();
  r = await S("55");
  ok(r.status === 401, "без сесії → 401");

  console.log(`\n✅ Усі перевірки пройдено: ${passed}`);
}
main().catch((e) => {
  console.error("\n❌ " + e.message);
  process.exit(1);
});
