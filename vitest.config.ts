import { defineConfig } from "vitest/config";

// Юніт-тести чистої логіки (напр. recalcShares, TOTP anti-replay) —
// у node-середовищі, без cloudflare-плагіна.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
