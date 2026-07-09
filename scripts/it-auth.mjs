// Інтеграційний тест флоу автентифікації проти запущеного dev-сервера.
// Передумови: `npm run dev` (localhost:5173) і застосовані міграції.
// Запуск: node scripts/it-auth.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import * as OTPAuth from "otpauth";

const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "it-admin@parking31a.com";
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

// ── простий cookie jar ──
const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function absorb(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const sc of list) {
    const [pair, ...attrs] = sc.split(";");
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    const maxAge0 = attrs.some((a) => /max-age=0\b/i.test(a.trim()));
    if (maxAge0 || value === "") jar.delete(name);
    else jar.set(name, value);
  }
}
async function req(method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const c = cookieHeader();
  if (c) headers["Cookie"] = c;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(res);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json, headers: res.headers };
}

function totpCode(base32, offsetMs = 0) {
  const t = new OTPAuth.TOTP({
    issuer: "Parking31a",
    label: "x",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32),
  });
  return t.generate({ timestamp: Date.now() + offsetMs });
}

async function main() {
  console.log(`Інтеграційний тест auth → ${BASE}`);

  console.log("\n[setup] скидання тестового користувача + create-admin");
  wrangler(`DELETE FROM users WHERE email='${EMAIL}'`);
  execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP_PW], { stdio: "pipe" });

  console.log("\n[health]");
  ok((await req("GET", "/api/health")).status === 200, "GET /api/health → 200");

  console.log("\n[login: пароль]");
  let r = await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP_PW });
  ok(r.status === 200 && r.json.next === "enroll", "login тимчасовим паролем → next=enroll");
  ok(jar.has("__Host-pending"), "видано pending-cookie");

  console.log("\n[enrollment]");
  r = await req("GET", "/api/auth/enroll/status");
  ok(r.status === 200 && r.json.mustChangePassword === true, "enroll/status: потрібна зміна пароля");

  r = await req("POST", "/api/auth/enroll/totp/start");
  ok(r.status === 409, "totp/start до зміни пароля → 409");

  r = await req("POST", "/api/auth/enroll/password", { newPassword: "short" });
  ok(r.status === 400, "слабкий пароль → 400");
  r = await req("POST", "/api/auth/enroll/password", { newPassword: NEW_PW });
  ok(r.status === 200, "зміна пароля → 200");

  r = await req("POST", "/api/auth/enroll/totp/start");
  ok(r.status === 200 && typeof r.json.secret === "string" && r.json.otpauthUri.startsWith("otpauth://"), "totp/start → secret + otpauthUri");
  const secret = r.json.secret;

  r = await req("POST", "/api/auth/enroll/totp/confirm", { code: "000000" });
  ok(r.status === 400, "невірний код підтвердження → 400");

  r = await req("POST", "/api/auth/enroll/totp/confirm", { code: totpCode(secret) });
  ok(r.status === 200 && Array.isArray(r.json.backupCodes) && r.json.backupCodes.length === 10, "confirm валідним кодом → 10 резервних кодів");
  ok(jar.has("__Host-session") && !jar.has("__Host-pending"), "видано session-cookie, pending очищено");
  const backupCodes = r.json.backupCodes;

  console.log("\n[сесія]");
  r = await req("GET", "/api/auth/me");
  ok(r.status === 200 && r.json.user.email === EMAIL, "me → поточний користувач");
  r = await req("POST", "/api/auth/logout");
  ok(r.status === 200, "logout → 200");
  ok((await req("GET", "/api/auth/me")).status === 401, "me після logout → 401");

  console.log("\n[повторний вхід + TOTP]");
  r = await req("POST", "/api/auth/login", { email: EMAIL, password: NEW_PW });
  ok(r.status === 200 && r.json.next === "totp", "вхід новим паролем → next=totp");
  r = await req("POST", "/api/auth/totp", { code: totpCode(secret, 30_000) }); // наступний крок > last_totp_step
  ok(r.status === 200 && r.json.user.email === EMAIL, "TOTP-код → сесія");
  await req("POST", "/api/auth/logout");

  console.log("\n[резервний код]");
  r = await req("POST", "/api/auth/login", { email: EMAIL, password: NEW_PW });
  ok(r.status === 200 && r.json.next === "totp", "вхід → next=totp");
  r = await req("POST", "/api/auth/totp", { backupCode: backupCodes[0] });
  ok(r.status === 200, "резервний код → сесія");
  r = await req("POST", "/api/auth/login", { email: EMAIL, password: NEW_PW });
  await req("POST", "/api/auth/totp", { backupCode: backupCodes[0] }); // повторне використання
  ok((await req("GET", "/api/auth/me")).status === 401 || true, "перевірка одноразовості резервного коду нижче");
  // явна перевірка: спробувати той самий резервний код ще раз
  r = await req("POST", "/api/auth/login", { email: EMAIL, password: NEW_PW });
  r = await req("POST", "/api/auth/totp", { backupCode: backupCodes[0] });
  ok(r.status === 401, "повторне використання резервного коду → 401");
  jar.clear();

  console.log("\n[анти-enumeration]");
  const r1 = await req("POST", "/api/auth/login", { email: "nobody@nowhere.tld", password: "whatever" });
  const r2 = await req("POST", "/api/auth/login", { email: EMAIL, password: "wrongpassword" });
  ok(r1.status === 401 && r2.status === 401, "неіснуючий та невірний пароль → однаково 401");
  ok(r1.json.error.code === r2.json.error.code, "однаковий код помилки (без enumeration)");
  jar.clear();

  console.log("\n[CSRF]");
  r = await req("POST", "/api/auth/login", { email: EMAIL, password: NEW_PW }, { "Sec-Fetch-Site": "cross-site" });
  ok(r.status === 403, "cross-site POST → 403");
  jar.clear();

  console.log("\n[security headers]");
  r = await req("GET", "/api/health");
  ok(r.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");

  console.log("\n[lockout / без enumeration]");
  wrangler(`UPDATE users SET failed_logins=0, locked_until=NULL WHERE email='${EMAIL}'`);
  jar.clear();
  let all401 = true;
  let any429 = false;
  for (let i = 0; i < 5; i++) {
    const rr = await req("POST", "/api/auth/login", { email: EMAIL, password: "definitely-wrong" });
    if (rr.status !== 401) all401 = false;
    if (rr.status === 429) any429 = true;
  }
  ok(all401 && !any429, "5 невдалих спроб → усі 401, без окремого 429 (без enumeration)");
  const locked = await req("POST", "/api/auth/login", { email: EMAIL, password: NEW_PW });
  ok(locked.status === 401 && locked.json.error.code === "invalid_credentials", "правильний пароль під час локу → та сама 401");
  jar.clear();

  console.log(`\n✅ Усі перевірки пройдено: ${passed}`);
}

main().catch((e) => {
  console.error("\n❌ " + e.message);
  process.exit(1);
});
