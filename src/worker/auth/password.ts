// Паролі: PBKDF2-HMAC-SHA-256, 100 000 ітерацій (максимум runtime Workers).
// Формат зберігання: pbkdf2$sha256$<iter>$<salt_b64>$<hash_b64>
import { toB64, fromB64, randomBytes, constantTimeEqual } from "../lib/crypto";

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

async function deriveBits(password: string, salt: Uint8Array, iterations: number, lenBytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, key, lenBytes * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await deriveBits(password, salt, ITERATIONS, KEY_BYTES);
  return `pbkdf2$sha256$${ITERATIONS}$${toB64(salt)}$${toB64(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromB64(parts[3]);
    expected = fromB64(parts[4]);
  } catch {
    return false;
  }
  if (expected.length !== KEY_BYTES || salt.length === 0) return false; // фіксована коректна довжина
  const derived = await deriveBits(password, salt, iterations, KEY_BYTES);
  return constantTimeEqual(derived, expected);
}
