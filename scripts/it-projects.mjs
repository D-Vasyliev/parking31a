// Інтеграційний тест проєктів (поділ вартості, оплати, перерахунок, автонотатки, стан-машина).
// Запуск: node scripts/it-projects.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import * as OTPAuth from "otpauth";

const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "it-proj@parking31a.com";
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
  wrangler(`DELETE FROM notes; DELETE FROM project_spots; DELETE FROM projects; DELETE FROM spot_owners; DELETE FROM owners;`);
  execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP], { stdio: "pipe" });
  await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP });
  await req("POST", "/api/auth/enroll/password", { newPassword: NEW });
  const s = await req("POST", "/api/auth/enroll/totp/start");
  await req("POST", "/api/auth/enroll/totp/confirm", { code: code(s.json.secret) });
}
const part = (detail, num) => detail.participants.find((p) => p.number === num);

async function main() {
  console.log(`Інтеграційний тест проєктів → ${BASE}`);
  console.log("\n[auth + reset]");
  await auth();
  ok(jar.has("__Host-session"), "автентифіковано");
  await req("PUT", "/api/spots/1/owner", { fullName: "Учасник Один" });

  console.log("\n[створення + склад + поділ]");
  let r = await req("POST", "/api/projects", { title: "Відеонагляд", totalKop: 1_234_567 });
  ok(r.status === 201 && r.json.status === "draft", "створено чернетку");
  const id = r.json.id;
  r = await req("PUT", `/api/projects/${id}/spots`, { numbers: Array.from({ length: 37 }, (_, i) => i + 1) });
  ok(r.status === 200 && r.json.participants.length === 37, "37 учасників");
  ok(part(r.json, 1).shareKop === 33367 && part(r.json, 37).shareKop === 33366, "частки: №1=333,67 №37=333,66");
  ok(r.json.participants.reduce((a, p) => a + p.shareKop, 0) === 1_234_567, "сума часток = вартість");

  console.log("\n[активація + борг]");
  r = await req("POST", `/api/projects/${id}/status/activate`);
  ok(r.status === 200 && r.json.status === "active", "активовано");
  r = await req("GET", "/api/spots");
  ok(r.json.find((s) => s.number === 1).hasDebt === true, "місце №1 має борг (активний, несплачено)");

  console.log("\n[оплати]");
  r = await req("POST", `/api/projects/${id}/payments`, { numbers: [1, 2, 3], paymentMethod: "cash" });
  ok(r.status === 200 && part(r.json, 1).status === "paid" && r.json.collectedKop === 3 * 33367, "оплачено 3 місця, зібрано 3×333,67");
  r = await req("GET", "/api/spots");
  ok(r.json.find((s) => s.number === 1).hasDebt === false, "сплачене місце №1 без боргу");

  console.log("\n[захист вилучення сплаченого + перерахунок]");
  r = await req("PUT", `/api/projects/${id}/spots`, { numbers: Array.from({ length: 36 }, (_, i) => i + 2) });
  ok(r.status === 409, "вилучити сплачене місце → 409");
  r = await req("PUT", `/api/projects/${id}/spots`, { numbers: Array.from({ length: 38 }, (_, i) => i + 1) });
  ok(r.status === 200 && r.json.participants.length === 38, "додано 38-е місце");
  ok(part(r.json, 1).status === "overpaid" && part(r.json, 1).delta === 33367 - part(r.json, 1).shareKop, "після перерахунку №1 — переплата");

  console.log("\n[скасування оплати]");
  r = await req("POST", `/api/projects/${id}/payments/cancel`, { number: 1, reason: "тест" });
  ok(r.status === 200 && part(r.json, 1).status === "unpaid" && part(r.json, 1).paidKop === 0, "оплату №1 скасовано");

  console.log("\n[завершення + автонотатки]");
  await req("POST", `/api/projects/${id}/payments/cancel`, { number: 2, reason: "тест" });
  await req("POST", `/api/projects/${id}/payments/cancel`, { number: 3, reason: "тест" });
  r = await req("PUT", `/api/projects/${id}/spots`, { numbers: [10, 11, 12] });
  ok(r.status === 200 && r.json.participants.length === 3, "новий склад: 3 місця (після скасування оплат 2,3)");
  await req("POST", `/api/projects/${id}/payments`, { numbers: [10, 11] });
  r = await req("POST", `/api/projects/${id}/status/complete`);
  ok(r.status === 200 && r.json.status === "completed", "проєкт завершено");
  r = await req("GET", "/api/spots/10");
  ok(r.json.notes.some((n) => n.kind === "project_auto"), "місце №10 отримало авто-нотатку");
  ok(r.json.notes.every((n) => n.kind !== "project_auto") === false && r.json.projects.some((p) => p.projectId === id && p.status === "completed"), "участь у завершеному проєкті видима");
  r = await req("GET", "/api/spots/12");
  ok(r.json.notes.every((n) => n.kind !== "project_auto"), "несплачене місце №12 без авто-нотатки");

  console.log("\n[розвершення прибирає нотатки]");
  r = await req("POST", `/api/projects/${id}/status/uncomplete`);
  ok(r.status === 200 && r.json.status === "active", "розвершено");
  r = await req("GET", "/api/spots/10");
  ok(r.json.notes.every((n) => n.kind !== "project_auto"), "авто-нотатку прибрано");

  console.log("\n[стан-машина]");
  r = await req("DELETE", `/api/projects/${id}`);
  ok(r.status === 409, "видалити активний → 409 (лише чернетка)");
  r = await req("POST", `/api/projects/${id}/status/cancel`);
  ok(r.status === 200 && r.json.status === "archived" && r.json.cancelled === true, "скасовано → архів (cancelled)");

  console.log("\n[список + guard]");
  r = await req("GET", "/api/projects");
  ok(r.status === 200 && r.json.some((p) => p.id === id), "проєкт у списку");
  jar.clear();
  r = await req("GET", "/api/projects");
  ok(r.status === 401, "без сесії → 401");

  console.log(`\n✅ Усі перевірки пройдено: ${passed}`);
}
main().catch((e) => {
  console.error("\n❌ " + e.message);
  process.exit(1);
});
