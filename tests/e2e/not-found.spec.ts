import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers";

// 404 bergaya Hashi (T-029). Next.js menyisipkan gaya global di 404 bawaan (`body{color:#fff;background:#000}` untuk peramban mode GELAP) yang bocor ke shell aplikasi
// (judul dan nama organisasi putih di atas latar terang). Hashi punya not-found.tsx sendiri, dan `color-scheme: light` (belum mendukung mode gelap).

const MISSING = "00000000-0000-4000-8000-000000000001"; // UUID sah yang tidak ada
const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
const isWhite = (c: string) => rgb(c).length === 3 && rgb(c).every((v) => v >= 250);
const isBlack = (c: string) => rgb(c).length === 3 && rgb(c).every((v) => v <= 5);

async function pageFor(browser: Browser, email: string, colorScheme: "dark" | "light"): Promise<Page> {
  const page = await (await browser.newContext({ colorScheme })).newPage();
  await login(page, email);
  return page;
}
const styles = (p: Page) =>
  p.evaluate(() => {
    const cs = (e: Element) => getComputedStyle(e);
    const h1 = document.querySelector("h1");
    const org = document.querySelector("[data-testid=org-card] div");
    return {
      bodyColor: cs(document.body).color,
      bodyBg: cs(document.body).backgroundColor,
      h1Color: h1 ? cs(h1).color : null,
      orgColor: org ? cs(org).color : null,
      colorScheme: cs(document.documentElement).colorScheme,
      styleTags: [...document.querySelectorAll("style")].filter((s) => /color:\s*#fff|background:\s*#000/i.test(s.textContent ?? "")).length,
    };
  });

test("404 di dalam aplikasi: status 404, bergaya Hashi (id), tombol ke Beranda, tanpa rincian teknis; peramban mode GELAP tidak merusak warna", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test", "dark"); // tsk.staff berbahasa Indonesia
  const res = await page.goto(`/records/workers/${MISSING}`);
  expect(res!.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect(page.getByTestId("not-found")).toContainText("tidak ditemukan");
  await expect(page.getByTestId("not-found-home")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("org-card")).toBeVisible(); // di dalam shell (sidebar tetap ada)
  expect(await page.content()).not.toContain("This page could not be found");
  const s = await styles(page);
  expect(isWhite(s.bodyColor), `warna teks body ${s.bodyColor}`).toBe(false);
  expect(isBlack(s.bodyBg), `latar body ${s.bodyBg}`).toBe(false);
  expect(s.h1Color && isWhite(s.h1Color), `judul ${s.h1Color}`).toBeFalsy();
  expect(s.orgColor && isWhite(s.orgColor), `nama organisasi ${s.orgColor}`).toBeFalsy();
  expect(s.colorScheme).toBe("light");
  expect(s.styleTags).toBe(0);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS_DIR ?? "docs/screenshots/T-029"}/404-mode-gelap.png` });
  // pindah ke Beranda lewat tautan (navigasi klien): gayanya tetap benar
  await page.getByTestId("not-found-home").click();
  await page.waitForURL("/");
  const home = await styles(page);
  expect(isWhite(home.bodyColor), `body di beranda ${home.bodyColor}`).toBe(false);
  expect(home.h1Color && isWhite(home.h1Color), `judul beranda ${home.h1Color}`).toBeFalsy();
  expect(home.orgColor && isWhite(home.orgColor), `nama organisasi beranda ${home.orgColor}`).toBeFalsy();
  await page.context().close();
});

test("404 hak akses TETAP 404 (tidak membocorkan apakah data ada): sensei membuka halaman TSK; LPK membuka pekerja; tampilan sama dengan id tidak ada", async ({ browser }) => {
  const sensei = await pageFor(browser, "lpk1.sensei@hashi.test", "dark");
  const r1 = await sensei.goto("/records/cards");
  expect(r1!.status()).toBe(404);
  await expect(sensei.getByTestId("not-found")).toBeVisible();
  const lpk = await pageFor(browser, "lpk1.admin@hashi.test", "dark");
  const r2 = await lpk.goto(`/records/workers/${MISSING}`);
  expect(r2!.status()).toBe(404);
  const r3 = await lpk.goto(`/records/workers/${"11111111-1111-4111-8111-111111111111"}`);
  expect(r3!.status()).toBe(404);
  expect(await lpk.getByTestId("not-found").innerText()).toBe(await (async () => { await lpk.goto(`/records/workers/${MISSING}`); return lpk.getByTestId("not-found").innerText(); })());
  await sensei.context().close();
  await lpk.context().close();
});

test("404 berbahasa Jepang untuk pengguna ja; alamat yang tidak ada sama sekali (di luar shell) juga bergaya Hashi, terang walau peramban gelap", async ({ browser }) => {
  const ja = await pageFor(browser, "tsk.admin@hashi.test", "dark"); // tsk.admin berbahasa Jepang
  const res = await ja.goto("/halaman-yang-tidak-ada-sama-sekali");
  expect(res!.status()).toBe(404);
  await expect(ja.getByTestId("not-found")).toContainText("見つかりません");
  const s = await styles(ja);
  expect(isWhite(s.bodyColor)).toBe(false);
  expect(isBlack(s.bodyBg)).toBe(false);
  expect(s.colorScheme).toBe("light");
  await ja.context().close();
});
