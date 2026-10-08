import "dotenv/config";
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { assertTestDatabase } from "./scripts/db-guard";

// Tangkapan layar buku panduan (T-030): `npm run guide:shots` (reseed dev + seed:pilot + build + jalankan). HANYA database dev/test/demo:
// skenario MENAMBAH data (kandidat, job order, catatan, ...). Tidak pernah ke produksi.
assertTestDatabase("guide:shots");
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/guide",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 600_000,
  use: { actionTimeout: 20_000, navigationTimeout: 45_000, baseURL: `http://localhost:${PORT}`, launchOptions: { args: ["--lang=id-ID"], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve-standalone.mjs",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), STORAGE_DIR: process.env.E2E_STORAGE_DIR ?? `${process.cwd()}/docs-data`, CARD_DATA_KEY: process.env.CARD_DATA_KEY || randomBytes(32).toString("base64") },
  },
});
