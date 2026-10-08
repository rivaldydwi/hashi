import "dotenv/config";
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { assertTestDatabase } from "./scripts/db-guard";

// Ukur waktu server halaman utama pada volume PILOT (T-014): `npm run perf:pages` setelah `db:seed -- --reset` + `seed:pilot`, terhadap build standalone (npm run build dulu).
// Hanya database dev/test/demo; tidak menambah data (hanya membaca halaman).
assertTestDatabase("perf:pages");
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/perf",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 300_000,
  use: { baseURL: `http://localhost:${PORT}`, launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {} },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve-standalone.mjs",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), STORAGE_DIR: process.env.E2E_STORAGE_DIR ?? `${process.cwd()}/docs-data`, CARD_DATA_KEY: process.env.CARD_DATA_KEY || randomBytes(32).toString("base64") },
  },
});
