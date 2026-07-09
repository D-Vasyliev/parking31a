import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Один Vite-білд: React SPA + Cloudflare Worker (Hono) у workerd.
// `vite dev` піднімає воркер локально з емуляціями D1/R2 і HMR фронтенду.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
