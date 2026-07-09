// Створює й повністю реєструє адміна через API, друкує креденшели + TOTP-секрет
// (для ручної/браузерної перевірки). Запуск: node scripts/mk-browser-admin.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import * as OTPAuth from "otpauth";

const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "browser@parking31a.com";
const TEMP = "TempPassw0rd!!";
const NEW = "NewStr0ngPass!234";
const wr = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const jar = new Map();

function wrangler(sql) {
  execFileSync(process.execPath, [wr, "d1", "execute", "parking-db", "--local", "--command", sql], { stdio: "pipe" });
}
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

wrangler(`DELETE FROM users WHERE email='${EMAIL}'`);
execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP], { stdio: "pipe" });
await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP });
await req("POST", "/api/auth/enroll/password", { newPassword: NEW });
const s = await req("POST", "/api/auth/enroll/totp/start");
await req("POST", "/api/auth/enroll/totp/confirm", { code: code(s.json.secret) });
console.log("EMAIL=" + EMAIL);
console.log("PASSWORD=" + NEW);
console.log("SECRET=" + s.json.secret);
