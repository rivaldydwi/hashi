import { expect, test } from "@playwright/test";
import { expectLoginRejected, login } from "./helpers";

// Hak akses dasar dengan data demo dari `npm run db:seed`.

test("password salah ditolak dengan pesan error", async ({ page }) => {
  await expectLoginRejected(page, "lpk1.admin@hashi.test", "salah-total");
});

test("LPK hanya melihat 12 kandidatnya sendiri", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates");
  await expect(page.getByTestId("candidate-total")).toHaveText("12");
});

// TSK melihat semua status LPK dari LPK mitra (12 + 12 = 24), kecuali 1 kandidat demo yang sengaja
// belum punya tanggal persetujuan berbagi data (lihat NO_CONSENT di scripts/seed.ts) -> 23.
test("TSK melihat 21 kandidat dari 2 LPK mitra (3 yang belum dibagikan tidak terlihat)", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  await page.goto("/candidates");
  await expect(page.getByTestId("candidate-total")).toHaveText("21");
});

test("ganti bahasa ke Jepang lalu kembali ke Indonesia", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.getByRole("button", { name: "日本語" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("link", { name: "ホーム", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Indonesia" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.getByRole("link", { name: "Beranda", exact: true })).toBeVisible();
});

test("sensei tidak bisa membuka halaman kelola pengguna", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await expect(page.getByRole("link", { name: "Pengguna" })).toHaveCount(0);
  await page.goto("/users");
  await expect(page).toHaveURL(/\/$/);
});

test("admin LPK tidak bisa membuka halaman super admin", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/admin/organizations");
  await expect(page).toHaveURL(/\/$/);
});

test("super admin melihat jumlah pengguna & kandidat yang benar", async ({ page }) => {
  await login(page, "admin@hashi.test");
  await page.goto("/admin/organizations");
  const bandung = page.getByTestId("org-table").getByRole("row", { name: /LPK Demo Bandung/ });
  await expect(bandung.getByRole("cell").nth(2)).toHaveText("2");
  await expect(bandung.getByRole("cell").nth(3)).toHaveText("12");
});
