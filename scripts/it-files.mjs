// Інтеграційний тест прикріплених файлів проти dev-сервера.
// Передумови: `npm run dev` + міграції --local (включно з 0006). Запуск: node scripts/it-files.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";

const require = createRequire(import.meta.url);
const BASE = process.argv[2] || "http://localhost:5173";
const EMAIL = "it-files@parking31a.com";
const TEMP_PW = "TempPassw0rd!!";
const NEW_PW = "NewStr0ngPass!234";
const wr = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("ПРОВАЛ: " + msg);
  passed++;
  console.log("  ✓ " + msg);
}
function wrangler(sql) {
  execFileSync(process.execPath, [wr, "d1", "execute", "parking-db", "--local", "--command", sql], { stdio: "pipe" });
}

const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
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
async function req(m, path, body, headers = {}) {
  const h = { ...headers };
  const c = cookie();
  if (c) h.Cookie = c;
  if (body !== undefined && typeof body === "object" && !(body instanceof Blob)) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method: m, headers: h, body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body) });
  absorb(res);
  let json = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) { try { json = await res.json(); } catch { /* */ } }
  return { status: res.status, json, headers: res.headers, res };
}
async function upload(entityType, entityId, name, type, bytes) {
  return req("POST", `/api/files?entityType=${entityType}&entityId=${entityId}&name=${encodeURIComponent(name)}`, new Blob([bytes], { type }), { "Content-Type": type });
}
function totp(s) {
  return new OTPAuth.TOTP({ issuer: "Parking31a", label: "x", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(s) }).generate();
}

function makePdf(text) {
  let pdf = "%PDF-1.4\n";
  const off = [];
  const add = (s) => { off.push(pdf.length); pdf += s; };
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  add("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  add("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 140] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");
  const stream = `BT /F1 20 Tf 30 70 Td (${text}) Tj ET`;
  add(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  add("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (const o of off) pdf += String(o).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
async function makeDocx(text) {
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word").file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return await zip.generateAsync({ type: "uint8array" });
}
// 1×1 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));

async function main() {
  console.log(`Інтеграційний тест files → ${BASE}`);
  console.log("\n[setup]");
  wrangler(`DELETE FROM users WHERE email='${EMAIL}'`);
  execFileSync(process.execPath, [join("scripts", "create-admin.mjs"), "--email", EMAIL, "--password", TEMP_PW], { stdio: "pipe" });

  console.log("\n[auth без сесії]");
  ok((await req("GET", "/api/files?entityType=article&entityId=1")).status === 401, "список без входу → 401");

  console.log("\n[login+enroll]");
  let r = await req("POST", "/api/auth/login", { email: EMAIL, password: TEMP_PW });
  ok(r.status === 200 && r.json.next === "enroll", "login → enroll");
  await req("POST", "/api/auth/enroll/password", { newPassword: NEW_PW });
  r = await req("POST", "/api/auth/enroll/totp/start");
  const secret = r.json.secret;
  ok((await req("POST", "/api/auth/enroll/totp/confirm", { code: totp(secret) })).status === 200, "2ФА → сесія");

  console.log("\n[стаття для тесту]");
  r = await req("POST", "/api/articles", { title: "Файли-демо", body: "Стаття з прикріпленими файлами для перевірки прев'ю." });
  const articleId = r.json.id;
  ok(typeof articleId === "number", "створено статтю #" + articleId);

  console.log("\n[валідація]");
  ok((await upload("bogus", articleId, "x.txt", "text/plain", new TextEncoder().encode("x"))).status === 400, "невідомий entityType → 400");
  ok((await upload("article", 999999, "x.txt", "text/plain", new TextEncoder().encode("x"))).status === 404, "неіснуюча стаття → 404");

  console.log("\n[завантаження PDF/PNG/DOCX]");
  const rp = await upload("article", articleId, "інструкція.pdf", "application/pdf", makePdf("Test PDF preview"));
  ok(rp.status === 201, "PDF → 201");
  const rn = await upload("article", articleId, "схема.png", "image/png", PNG);
  ok(rn.status === 201, "PNG → 201");
  const dbytes = await makeDocx("Тестовий документ Word — прев'ю працює.");
  const rd = await upload("article", articleId, "договір.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dbytes);
  ok(rd.status === 201, "DOCX → 201");

  console.log("\n[список + вміст]");
  r = await req("GET", `/api/files?entityType=article&entityId=${articleId}`);
  ok(r.status === 200 && r.json.length === 3, "список → 3 файли");
  ok(r.json.some((a) => a.filename === "інструкція.pdf" && a.contentType === "application/pdf"), "збережено імʼя + тип (кирилиця)");

  const pdfId = r.json.find((a) => a.filename.endsWith(".pdf")).id;
  const raw = await req("GET", `/api/files/${pdfId}/raw`);
  ok(raw.status === 200 && raw.headers.get("content-type") === "application/pdf", "raw PDF → 200 application/pdf");
  ok((raw.headers.get("content-disposition") || "").startsWith("inline"), "PDF inline (для вбудованого перегляду)");
  const dl = await req("GET", `/api/files/${pdfId}/raw?download=1`);
  ok((dl.headers.get("content-disposition") || "").startsWith("attachment"), "?download=1 → attachment");

  console.log("\n[видалення]");
  const pngId = r.json.find((a) => a.filename.endsWith(".png")).id;
  ok((await req("DELETE", `/api/files/${pngId}`)).status === 200, "видалення PNG → 200");
  ok((await req("GET", `/api/files?entityType=article&entityId=${articleId}`)).json.length === 2, "лишилось 2 файли");
  ok((await req("DELETE", `/api/files/${pngId}`)).status === 404, "повторне видалення → 404");

  console.log("\n[каскад при видаленні статті]");
  // окрема стаття для перевірки каскаду
  const a2 = (await req("POST", "/api/articles", { title: "каскад" })).json.id;
  await upload("article", a2, "f.txt", "text/plain", new TextEncoder().encode("bye"));
  await req("DELETE", `/api/articles/${a2}`);
  ok((await req("GET", `/api/files?entityType=article&entityId=${a2}`)).json.length === 0, "видалення статті прибрало її файли");

  console.log(`\n✅ Усі перевірки пройдено: ${passed}. Стаття #${articleId} лишена з PDF+DOCX для перегляду в браузері.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
