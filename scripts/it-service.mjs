// Інтеграційний тест етапу 6: користувачі, аудит, безпека акаунта, бекап.
// Запуск: node scripts/it-service.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import * as OTPAuth from "otpauth";

const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "it-svc@parking31a.com";
const TEMP = "TempPassw0rd!!";
const NEW = "NewStr0ngPass!234";
const NEWER = "Even!StrongerPass9";
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
const totp = (s, off = 0) => new OTPAuth.TOTP({ issuer: "Parking31a", label: "x", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(s) }).generate({ timestamp: Date.now() + off });

async function auth() {
  wrangler(`DELETE FROM users WHERE email LIKE 'it-svc%' OR email='new-admin@parking31a.com'`);
  execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP], { stdio: "pipe" });
  await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP });
  await req("POST", "/api/auth/enroll/password", { newPassword: NEW });
  const s = await req("POST", "/api/auth/enroll/totp/start");
  await req("POST", "/api/auth/enroll/totp/confirm", { code: totp(s.json.secret) });
  return s.json.secret;
}

async function main() {
  console.log(`Інтеграційний тест сервісу → ${BASE}`);
  console.log("\n[auth]");
  await auth();
  const me = await req("GET", "/api/auth/me");
  const selfId = me.json.user.id;
  ok(jar.has("__Host-session"), "автентифіковано");

  console.log("\n[користувачі]");
  let r = await req("GET", "/api/users");
  ok(r.status === 200 && r.json.some((u) => u.email === EMAIL && u.role === "admin"), "список містить себе");
  r = await req("POST", "/api/users", { email: "new-admin@parking31a.com" });
  ok(r.status === 201 && typeof r.json.tempPassword === "string" && r.json.tempPassword.length >= 12, "створено адміна з тимчасовим паролем");
  const newId = (await req("GET", "/api/users")).json.find((u) => u.email === "new-admin@parking31a.com").id;
  r = await req("POST", "/api/users", { email: "new-admin@parking31a.com" });
  ok(r.status === 409, "дубль email → 409");
  r = await req("POST", `/api/users/${newId}/reset-password`);
  ok(r.status === 200 && r.json.tempPassword, "скидання пароля → новий тимчасовий");
  r = await req("POST", `/api/users/${selfId}/active`, { active: false });
  ok(r.status === 409 && r.json.error.code === "self", "деактивація себе → 409");
  r = await req("POST", `/api/users/${newId}/active`, { active: false });
  ok(r.status === 200, "деактивація іншого → 200");
  // тепер активний лише self → деактиваціяself заблокована і як self, і як останній
  r = await req("POST", `/api/users/${selfId}/active`, { active: false });
  ok(r.status === 409, "деактивація останнього активного адміна → 409");

  console.log("\n[бекап]");
  r = await req("POST", "/api/backup");
  ok(r.status === 200 && r.json.key.startsWith("backups/parking-") && r.json.rows > 0 && r.json.bytes > 0, "бекап створено (SQL-дамп gzip у R2)");

  console.log("\n[аудит]");
  r = await req("GET", "/api/audit");
  ok(r.status === 200 && Array.isArray(r.json) && r.json.length > 0, "журнал не порожній");
  r = await req("GET", "/api/audit?action=user.create");
  ok(r.json.length > 0 && r.json.every((e) => e.action === "user.create"), "фільтр за дією user.create");

  console.log("\n[резервні коди]");
  r = await req("POST", "/api/auth/backup-codes", { password: "wrong" });
  ok(r.status === 400, "невірний пароль → 400");
  r = await req("POST", "/api/auth/backup-codes", { password: NEW });
  ok(r.status === 200 && Array.isArray(r.json.backupCodes) && r.json.backupCodes.length === 10, "нові 10 резервних кодів");

  console.log("\n[переналаштування 2ФА]");
  r = await req("POST", "/api/auth/2fa/start");
  ok(r.status === 200 && r.json.secret && r.json.otpauthUri.startsWith("otpauth://"), "2fa/start → новий секрет");
  const s2 = r.json.secret;
  r = await req("POST", "/api/auth/2fa/confirm", { password: NEW, code: "000000", secret: s2 });
  ok(r.status === 400, "невірний код підтвердження → 400");
  r = await req("POST", "/api/auth/2fa/confirm", { password: NEW, code: totp(s2), secret: s2 });
  ok(r.status === 200 && r.json.backupCodes.length === 10, "2fa/confirm → перевлаштовано, нові коди");

  console.log("\n[зміна пароля]");
  r = await req("POST", "/api/auth/change-password", { currentPassword: "wrong", newPassword: NEWER });
  ok(r.status === 400, "невірний поточний пароль → 400");
  r = await req("POST", "/api/auth/change-password", { currentPassword: NEW, newPassword: NEWER });
  ok(r.status === 200, "зміну пароля прийнято");
  r = await req("GET", "/api/auth/me");
  ok(r.status === 200, "сесія лишається чинною після зміни (ротація)");

  console.log("\n[guard]");
  jar.clear();
  r = await req("GET", "/api/users");
  ok(r.status === 401, "без сесії → 401");

  console.log(`\n✅ Усі перевірки пройдено: ${passed}`);
}
main().catch((e) => {
  console.error("\n❌ " + e.message);
  process.exit(1);
});
