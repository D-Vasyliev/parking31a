import { describe, it, expect } from "vitest";
import * as OTPAuth from "otpauth";
import {
  generateSecretBase32,
  otpauthUri,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  hashBackupCode,
  formatBackupCode,
} from "./totp";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))); // 32-байтовий ключ у base64

function codeFor(base32: string, atMs: number): string {
  const t = new OTPAuth.TOTP({
    issuer: "Parking31a",
    label: "x",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32),
  });
  return t.generate({ timestamp: atMs });
}

describe("TOTP", () => {
  const now = 1_700_000_000_000;

  it("приймає валідний код, відхиляє replay", () => {
    const s = generateSecretBase32();
    const code = codeFor(s, now);
    const r1 = verifyTotp(s, code, null, now);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const r2 = verifyTotp(s, code, r1.step, now); // той самий крок → replay
      expect(r2.ok).toBe(false);
    }
  });

  it("відхиляє невірний код", () => {
    const s = generateSecretBase32();
    expect(verifyTotp(s, "000000", null, now).ok).toBe(false);
  });

  it("otpauth URI", () => {
    expect(otpauthUri(generateSecretBase32(), "admin@parking31a.com")).toMatch(/^otpauth:\/\/totp\//);
  });

  it("шифрування секрету — roundtrip, ciphertext не містить секрету", async () => {
    const s = generateSecretBase32();
    const enc = await encryptSecret(s, KEY);
    expect(enc).not.toContain(s);
    expect(await decryptSecret(enc, KEY)).toBe(s);
  });
});

describe("резервні коди", () => {
  it("10 унікальних кодів, стійкий хеш, нормалізація формату", async () => {
    const codes = generateBackupCodes(10, 10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const h = await hashBackupCode(codes[0]);
    expect(h).toHaveLength(64);
    // введення з дефісом/малими літерами дає той самий хеш
    expect(await hashBackupCode(formatBackupCode(codes[0]).toLowerCase())).toBe(h);
  });
});
