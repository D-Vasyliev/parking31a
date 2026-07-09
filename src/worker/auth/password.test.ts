import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password (PBKDF2)", () => {
  it("формат хешу і верифікація", async () => {
    const pw = "correct horse battery staple";
    const h = await hashPassword(pw);
    expect(h).toMatch(/^pbkdf2\$sha256\$100000\$/);
    expect(await verifyPassword(pw, h)).toBe(true);
    expect(await verifyPassword("wrong password", h)).toBe(false);
  });

  it("різні солі для однакового пароля", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("відхиляє некоректний формат", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$sha256$100000$bad")).toBe(false);
  });
});
