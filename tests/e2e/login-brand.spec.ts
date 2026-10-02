import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "./helpers";

// Halaman login baru + aset merek.

test("login tampil dalam bahasa Indonesia dan Jepang; pemilih bahasa bekerja sebelum login dan bertahan setelah reload", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Selamat datang kembali");
  await expect(page).toHaveTitle("Masuk · Hashi");
  await expect(page.getByTestId("brand-panel")).toContainText("Satu profil kandidat, dari LPK sampai TSK.");
  await page.getByRole("button", { name: "日本語" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("おかえりなさい");
  await expect(page).toHaveTitle("ログイン · Hashi");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("おかえりなさい");
  await page.getByRole("button", { name: "Indonesia" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Selamat datang kembali");
});

test("tampil/sembunyikan kata sandi: mengubah type dan aria-pressed, tanpa mengirim form", async ({ page }) => {
  await page.goto("/login");
  const pw = page.locator("#password");
  const toggle = page.getByTestId("toggle-password");
  await pw.fill("rahasia-uji");
  await expect(pw).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(pw).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("aria-label", "Sembunyikan kata sandi");
  await expect(page).toHaveURL(/\/login$/);
  await toggle.click();
  await expect(pw).toHaveAttribute("type", "password");
});

test("kredensial salah: kotak kesalahan sama untuk email tak ada dan sandi salah, email tetap, sandi kosong, fokus ke sandi", async ({ page }) => {
  for (const email of ["lpk1.admin@hashi.test", "tidak-ada@hashi.test"]) {
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill("salah-total");
    await page.locator("form button[type=submit]").click();
    const box = page.getByTestId("login-error");
    await expect(box).toHaveText("Email atau kata sandi salah. Coba lagi.");
    await expect(box).toHaveAttribute("role", "alert");
    await expect(page.locator("#email")).toHaveValue(email);
    await expect(page.locator("#password")).toHaveValue("");
    await expect(page.locator("#password")).toBeFocused();
  }
});

test("login benar mengikuti callbackUrl yang aman; yang berbahaya diabaikan", async ({ browser }) => {
  for (const [cb, expected] of [["/candidates", /\/candidates$/], ["//evil.example", /\/$/], ["https://evil.example/x", /\/$/], ["/login", /\/$/]] as const) {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/login?callbackUrl=${encodeURIComponent(cb)}`);
    await page.locator("#email").fill("lpk1.admin@hashi.test");
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.locator("form button[type=submit]").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL!).origin);
    expect(page.url()).toMatch(expected);
    await page.context().close();
  }
});

test("urutan Tab di ponsel: bahasa, email, kata sandi, tampil, Masuk", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  const idOf = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("data-testid") || document.activeElement?.textContent?.trim() || "");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); seen.push(await idOf()); }
  const order = ["Indonesia", "日本語"].filter((x) => seen.includes(x)).length === 2 ? seen : seen;
  const pos = (k: string) => order.findIndex((x) => x === k);
  expect(pos("日本語")).toBeGreaterThanOrEqual(0);
  expect(pos("日本語")).toBeLessThan(pos("email"));
  expect(pos("email")).toBeLessThan(pos("password"));
  expect(pos("password")).toBeLessThan(pos("toggle-password"));
  expect(pos("toggle-password")).toBeLessThan(order.findIndex((x) => x === "Masuk"));
  await ctx.close();
});

test.describe("ponsel 360px", () => {
  test.use({ viewport: { width: 360, height: 640 } });
  test("tanpa scroll horizontal; panel merek tersembunyi; target sentuh >= 44px", async ({ page }) => {
    await page.goto("/login");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("brand-panel")).toBeHidden();
    for (const sel of ["#email", "#password", "form button[type=submit]", "[data-testid=toggle-password]"]) expect((await page.locator(sel).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test("desktop: dua kolom 50/50 dengan panel merek", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  const panel = (await page.getByTestId("brand-panel").boundingBox())!;
  expect(Math.abs(panel.width - 640)).toBeLessThan(2);
  expect(panel.x).toBeGreaterThan(600);
});

test("aset merek: icon, apple-icon, favicon, manifest, ikon PWA membalas 200 dengan tipe benar", async ({ request }) => {
  for (const [path, type] of [["/icon.png", "image/png"], ["/apple-icon.png", "image/png"], ["/favicon.ico", "image/"], ["/manifest.webmanifest", "json"], ["/icons/icon-192.png", "image/png"], ["/icons/icon-512.png", "image/png"], ["/brand/logo-light@2x.png", "image/png"]] as const) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toContain(type);
  }
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m).toMatchObject({ name: "Hashi", short_name: "Hashi", theme_color: "#0F1424", background_color: "#FAF8F5" });
});

test("logo Hashi (bukan tile 橋) di login dan di sidebar setelah masuk", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('main img[alt="Hashi"]').first()).toBeVisible();
  await page.locator("#email").fill("lpk1.admin@hashi.test");
  await page.locator("#password").fill(DEMO_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await expect(page.getByTestId("sidebar").locator('img[alt="Hashi"]')).toBeVisible();
  expect(await page.getByTestId("sidebar").textContent()).not.toContain("橋");
});
