// TOTP 2ФА (RFC 6238) через otpauth + шифрування секрету AES-256-GCM.
import * as OTPAuth from "otpauth";
import { toB64, fromB64, randomBytes, sha256Hex } from "../lib/crypto";

const ISSUER = "Parking31a";
const PERIOD = 30;
const DIGITS = 6;
const ALGORITHM = "SHA1";
const WINDOW = 1;

function build(base32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(base32),
  });
}

export function generateSecretBase32(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function otpauthUri(base32: string, label: string): string {
  return OTPAuth.URI.stringify(build(base32, label));
}

/**
 * Перевірка TOTP з anti-replay. Повертає step (номер кроку), який треба зберегти
 * у users.last_totp_step; повторне використання того самого/старішого кроку відхиляється.
 */
export function verifyTotp(
  base32: string,
  token: string,
  lastStep: number | null,
  nowMs: number,
): { ok: true; step: number } | { ok: false } {
  const delta = build(base32, "x").validate({ token, window: WINDOW, timestamp: nowMs });
  if (delta === null) return { ok: false };
  const step = Math.floor(nowMs / 1000 / PERIOD) + delta;
  if (lastStep !== null && step <= lastStep) return { ok: false }; // replay
  return { ok: true, step };
}

// ── Шифрування секрету (AES-256-GCM, ключ TOTP_ENC_KEY у base64) ──
async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("TOTP_ENC_KEY має бути 32 байти у base64");
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(base32: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(base32)));
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return toB64(combined);
}

export async function decryptSecret(stored: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const data = fromB64(stored);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ct as BufferSource);
  return new TextDecoder().decode(pt);
}

// ── Резервні коди ──
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0,1,I,O (32 символи → без modulo-bias від 256)

export function generateBackupCodes(count = 10, len = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(len);
    let s = "";
    for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
    codes.push(s);
  }
  return codes;
}

export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatBackupCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function hashBackupCode(code: string): Promise<string> {
  return sha256Hex(normalizeBackupCode(code));
}
