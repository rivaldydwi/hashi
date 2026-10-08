import { test } from "@playwright/test";
import { login } from "../e2e/helpers";

// Tangkapan layar untuk PR T-014 (hanya bila SHOTS=1): /records/responsible dengan staf >= 45 pekerja (kuning), daftar kandidat 200+, dan /records/cards.
test.skip(!process.env.SHOTS, "set SHOTS=1 untuk mengambil tangkapan layar");

test("tangkapan layar pilot", async ({ browser }) => {
  const dir = process.env.SHOTS_DIR ?? "docs/screenshots/T-014";
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const tsk = await ctx.newPage();
  await login(tsk, "tsk.admin@hashi.test");
  await tsk.goto("/records/responsible");
  await tsk.waitForLoadState("networkidle");
  await tsk.screenshot({ path: `${dir}/responsible-staf-48-kuning.png`, fullPage: false });
  await tsk.goto("/records/cards");
  await tsk.waitForLoadState("networkidle");
  await tsk.screenshot({ path: `${dir}/kartu-semua-tahap.png`, fullPage: false });
  const lpk = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await login(lpk, "lpk1.admin@hashi.test");
  await lpk.goto("/candidates");
  await lpk.waitForLoadState("networkidle");
  await lpk.screenshot({ path: `${dir}/daftar-kandidat-bandung.png`, fullPage: false });
  await tsk.goto("/candidates");
  await tsk.waitForLoadState("networkidle");
  await tsk.screenshot({ path: `${dir}/daftar-kandidat-tsk.png`, fullPage: false });
});
