import { expect, test, type Browser } from "@playwright/test";
import { expectLoginRejected, login, logout, readTempPassword, unique } from "./helpers";

// Alur lengkap langkah 2: super admin membuat LPK baru -> admin LPK login pertama kali
// -> menambah & menonaktifkan sensei -> kemitraan -> reset kata sandi mencabut sesi.
// Data dibuat dengan nama unik, jadi aman dijalankan berulang kali.

test.describe.configure({ mode: "serial" });

const id = unique();
const orgName = `LPK E2E ${id}`;
const adminEmail = `e2e-admin-${id}@hashi.test`;
const senseiEmail = `e2e-sensei-${id}@hashi.test`;
const adminPassword = "Kata-Sandi-Baru-123";
let adminTempPassword = "";
let orgUrl = "";

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test("super admin membuat organisasi LPK baru beserta admin pertamanya", async ({ page }) => {
  await login(page, "admin@hashi.test");
  await page.goto("/admin/organizations/new");
  await page.locator("#name").fill(orgName);
  await page.locator("#type").selectOption("LPK");
  await page.locator("#adminName").fill("Admin E2E");
  await page.locator("#adminEmail").fill(adminEmail.toUpperCase()); // disimpan huruf kecil
  await page.locator("main form button[type=submit]").click();

  adminTempPassword = await readTempPassword(page);
  expect(adminTempPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

  await page.getByRole("link", { name: "Buka organisasi" }).click();
  await expect(page.getByRole("heading", { name: orgName })).toBeVisible();
  await expect(page.getByTestId("user-table")).toContainText(adminEmail);
  orgUrl = new URL(page.url()).pathname;
});

test("email yang sudah dipakai ditolak", async ({ page }) => {
  await login(page, "admin@hashi.test");
  await page.goto(`${orgUrl}/users/new`);
  await page.locator("#name").fill("Duplikat");
  await page.locator("#email").fill(adminEmail);
  await page.locator("main form button[type=submit]").click();
  await expect(page.locator("p[role=alert]")).toHaveText("Email ini sudah dipakai akun lain.");
});

test("admin baru wajib ganti kata sandi sementara saat login pertama", async ({ page }) => {
  await login(page, adminEmail, adminTempPassword);
  await expect(page).toHaveURL(/\/change-password/);

  // Belum bisa membuka halaman lain sebelum ganti kata sandi
  await page.goto("/users");
  await expect(page).toHaveURL(/\/change-password/);

  await page.locator("#currentPassword").fill(adminTempPassword);
  await page.locator("#newPassword").fill(adminPassword);
  await page.locator("#confirmPassword").fill(adminPassword);
  await page.locator("form button[type=submit]").first().click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("visible-count")).toHaveText("0");
});

test("kata sandi sementara tidak berlaku lagi setelah diganti", async ({ page }) => {
  await expectLoginRejected(page, adminEmail, adminTempPassword);
});

test("admin LPK menambah sensei, lalu menonaktifkannya", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, adminEmail, adminPassword);
  await page.getByRole("link", { name: "Pengguna" }).click();
  await page.getByRole("link", { name: /Tambah pengguna/ }).click();

  // Hanya peran LPK yang tersedia
  await expect(page.locator("#role option")).toHaveText(["Admin LPK", "Sensei LPK"]);
  await page.locator("#name").fill("Sensei E2E");
  await page.locator("#email").fill(senseiEmail);
  await page.locator("#role").selectOption("LPK_SENSEI");
  await page.locator("main form button[type=submit]").click();
  const senseiTemp = await readTempPassword(page);

  await page.getByRole("link", { name: "Kembali ke daftar pengguna" }).click();
  await page.getByTestId("user-table").getByRole("row", { name: /Sensei E2E/ }).getByRole("link").click();
  await page.getByRole("button", { name: "Nonaktifkan" }).click();
  await expect(page.getByRole("status")).toHaveText("Pengguna dinonaktifkan.");

  // Admin tidak bisa menonaktifkan dirinya sendiri (panel akses tidak muncul untuk diri sendiri)
  await page.goto("/users");
  await page.getByTestId("user-table").getByRole("row", { name: /Admin E2E/ }).getByRole("link").click();
  await expect(page.getByRole("button", { name: "Nonaktifkan" })).toHaveCount(0);
  await logout(page);

  await expectLoginRejected(page, senseiEmail, senseiTemp);
});

test("super admin membuat lalu menonaktifkan kemitraan TSK dengan LPK baru", async ({ page }) => {
  await login(page, "admin@hashi.test");
  await page.goto("/admin/partnerships");
  await page.locator("#lpkId").selectOption({ label: orgName });
  await page.locator("#tskId").selectOption({ label: "TSK Demo Tokyo" });
  await page.locator("main form button[type=submit]", { hasText: "Tambah kemitraan" }).click();
  await expect(page.getByRole("status")).toHaveText("Kemitraan dibuat.");

  const row = page.getByTestId("partnership-table").getByRole("row", { name: new RegExp(orgName) });
  await expect(row).toContainText("Aktif");

  // Kemitraan yang sama tidak bisa dibuat dua kali
  await page.locator("#lpkId").selectOption({ label: orgName });
  await page.locator("#tskId").selectOption({ label: "TSK Demo Tokyo" });
  await page.locator("main form button[type=submit]", { hasText: "Tambah kemitraan" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("Kemitraan ini sudah ada.");

  await row.getByRole("button", { name: "Nonaktifkan" }).click();
  await expect(row).toContainText("Nonaktif");
});

test("admin terakhir tidak bisa diturunkan perannya atau dinonaktifkan", async ({ page }) => {
  await login(page, "admin@hashi.test");
  await page.goto(orgUrl);
  await page.getByTestId("user-table").getByRole("row", { name: /Admin E2E/ }).getByRole("link").click();

  await page.locator("#role").selectOption("LPK_SENSEI");
  await page.getByRole("button", { name: "Simpan" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("Organisasi harus punya minimal satu admin aktif.");

  await page.getByRole("button", { name: "Nonaktifkan" }).click();
  await expect(page.locator("p[role=alert]").last()).toHaveText("Organisasi harus punya minimal satu admin aktif.");
});

test("reset kata sandi oleh super admin langsung mengeluarkan admin dari sesinya", async ({ browser }) => {
  const adminPage = await newPage(browser);
  await login(adminPage, adminEmail, adminPassword);
  await expect(adminPage.getByTestId("visible-count")).toBeVisible();

  const superPage = await newPage(browser);
  await login(superPage, "admin@hashi.test");
  await superPage.goto(orgUrl);
  await superPage.getByTestId("user-table").getByRole("row", { name: /Admin E2E/ }).getByRole("link").click();
  await superPage.getByRole("button", { name: "Buat kata sandi sementara baru" }).click();
  const newTemp = await readTempPassword(superPage);

  // Sesi lama admin tidak berlaku lagi
  await adminPage.reload();
  await expect(adminPage).toHaveURL(/\/login/);

  // Kata sandi lama ditolak, kata sandi sementara baru diterima (dan wajib diganti lagi)
  await expectLoginRejected(adminPage, adminEmail, adminPassword);
  await login(adminPage, adminEmail, newTemp);
  await expect(adminPage).toHaveURL(/\/change-password/);
});
