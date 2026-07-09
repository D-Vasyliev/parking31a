// Створює адміністратора у D1. При першому вході — зміна пароля + налаштування 2ФА.
// Використання:
//   node scripts/create-admin.mjs --email admin@parking31a.com [--password <pw>] [--remote]
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--remote") a.remote = true;
    else if (t.startsWith("--")) a[t.slice(2)] = argv[++i];
  }
  return a;
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256));
  return `pbkdf2$sha256$100000$${b64(salt)}$${b64(bits)}`;
}

function genPassword(len = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const L = alphabet.length;
  const max = 256 - (256 % L); // rejection sampling — без modulo-bias
  const out = [];
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len))) {
      if (b < max) {
        out.push(alphabet[b % L]);
        if (out.length === len) break;
      }
    }
  }
  return out.join("");
}

const args = parseArgs(process.argv.slice(2));
if (!args.email) {
  console.error("Вкажіть --email. Приклад: node scripts/create-admin.mjs --email admin@parking31a.com");
  process.exit(1);
}
const password = args.password || genPassword(16);
const hash = await hashPassword(password);
const location = args.remote ? "--remote" : "--local";
const emailSql = String(args.email).replace(/'/g, "''");
const sql = `INSERT INTO users (email, password_hash, role, must_change_pw, is_active) VALUES ('${emailSql}', '${hash}', 'admin', 1, 1);`;

const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
execFileSync(process.execPath, [wranglerBin, "d1", "execute", "parking-db", location, "--command", sql], { stdio: "inherit" });

console.log(`\n✅ Адміністратор створений: ${args.email}`);
console.log(`   Тимчасовий пароль: ${password}`);
console.log(`   Перший вхід: зміна пароля + налаштування 2ФА (QR).`);
