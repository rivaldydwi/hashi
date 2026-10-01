import "dotenv/config";
import { expect, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

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

/**
 * Buat LPK baru (tanpa kemitraan) beserta admin yang sudah ganti kata sandi, lewat UI super admin.
 * Dipakai tes yang menambah kandidat, supaya angka data demo (12 / 23 kandidat) tidak berubah
 * dan tes bisa dijalankan berulang kali.
 */
export async function createIsolatedLpk(browser: Browser) {
  const id = unique();
  const orgName = `LPK E2E Kandidat ${id}`;
  const adminEmail = `e2e-kandidat-${id}@hashi.test`;
  const adminPassword = "Kata-Sandi-Baru-123";

  const page = await (await browser.newContext()).newPage();
  await login(page, "admin@hashi.test");
  await page.goto("/admin/organizations/new");
  await page.locator("#name").fill(orgName);
  await page.locator("#type").selectOption("LPK");
  await page.locator("#adminName").fill("Admin E2E");
  await page.locator("#adminEmail").fill(adminEmail);
  await page.locator("main form button[type=submit]").click();
  const tempPassword = await readTempPassword(page);
  await logout(page);

  await login(page, adminEmail, tempPassword);
  await page.locator("#currentPassword").fill(tempPassword);
  await page.locator("#newPassword").fill(adminPassword);
  await page.locator("#confirmPassword").fill(adminPassword);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL(/\/$/);
  await page.context().close();
  return { orgName, adminEmail, adminPassword };
}

/** Query langsung ke database sebagai OWNER (melewati RLS) untuk memeriksa hasil, mis. audit log. */
export async function ownerQuery<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set (dipakai tes e2e untuk memeriksa database)");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/**
 * Kandidat uji milik tes sendiri (dibuat lewat database, dihapus lewat `deleteScratchCandidate`). Dipakai supaya tes yang
 * menambah/menghapus data kandidat TIDAK menyentuh data seed (seed lengkap dan dijaga `npm run verify:seed`).
 * Kandidat baru: tanpa keputusan TSK, tanpa penilaian, tanpa dokumen, dan tanpa data sensitif.
 */
export async function createScratchCandidate(opts: { name: string; org?: string; stage?: "STUDYING" | "READY" | "WITHDRAWN"; shared?: boolean }) {
  const [row] = await ownerQuery<{ id: string; organization_id: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
     select o.id, $1, 'MALE', '2000-05-15', (select id from skill_fields where code = 'food'), $3, $4 from organizations o where o.name = $2
     returning id, organization_id`,
    [opts.name, opts.org ?? "LPK Demo Bandung", opts.stage ?? "STUDYING", opts.shared ?? true],
  );
  return { id: row.id, orgId: row.organization_id, name: opts.name };
}

/** Hapus kandidat uji (turunannya ikut terhapus lewat FK cascade). Log audit tidak ikut terhapus. */
export async function deleteScratchCandidate(id: string) {
  await ownerQuery("delete from candidates where id = $1", [id]);
}
