import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = process.env.SEED_PASSWORD || "hashi-demo-2026";

/** Login lewat form. Menunggu sampai keluar dari halaman /login. */
export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Login yang diharapkan GAGAL: tetap di /login dan muncul pesan error. */
export async function expectLoginRejected(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("p[role=alert]")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: /^(Keluar|ログアウト)$/ }).click();
  await page.waitForURL(/\/login/);
}

/** Ambil kata sandi sementara yang tampil sekali setelah membuat / reset pengguna. */
export async function readTempPassword(page: Page): Promise<string> {
  const value = page.getByTestId("temp-password-value");
  await expect(value).toBeVisible();
  return (await value.textContent())!.trim();
}

export const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
