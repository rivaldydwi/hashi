import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createIsolatedLpk, login, ownerQuery, unique } from "./helpers";

// Form tambah kandidat langsung lengkap (satu halaman, satu tombol simpan, satu transaksi).
// Memakai LPK baru (tanpa kemitraan) supaya angka data demo tidak bergeser.

test.describe.configure({ mode: "serial" });

const run = unique();
const ROOT = path.resolve(process.env.E2E_STORAGE_DIR ?? `${process.cwd()}/.e2e-docs`);
const PDF = Buffer.from(`%PDF-1.4\n% formulir ${run}\n%%EOF\n`);
let lpk: { orgName: string; adminEmail: string; adminPassword: string };
let orgId = "";

test.beforeAll(async ({ browser }) => {
  lpk = await createIsolatedLpk(browser);
  [{ id: orgId }] = await ownerQuery<{ id: string }>("select id from organizations where name = $1", [lpk.orgName]);
});
test.afterAll(async () => {
  await rm(path.join(ROOT, orgId), { recursive: true, force: true });
});

const SELECTS = new Set(["relation", "type"]);
const CHECKS = new Set(["livesInJapan", "isEmergencyContact"]);
/** Isi satu baris berulang (keluarga, pendidikan, kerja, sertifikat) di form tambah kandidat. */
async function fillRow(page: Page, section: string, index: number, values: Record<string, string | boolean>) {
  const row: Locator = page.getByTestId(`create-row-${section}`).nth(index);
  for (const [name, v] of Object.entries(values)) {
    const el = row.locator(`[name$=".${name}"]`);
    if (CHECKS.has(name)) await (v ? el.check() : el.uncheck());
    else if (SELECTS.has(name)) await el.selectOption(String(v));
    else await el.fill(String(v));
  }
}
async function addRow(page: Page, section: string) {
  const before = await page.getByTestId(`create-row-${section}`).count();
  await page.getByTestId(`add-row-${section}`).click();
  await expect(page.getByTestId(`create-row-${section}`)).toHaveCount(before + 1);
}
async function fillRequired(page: Page, name: string, field = "Konstruksi") {
  await page.locator("#basic-fullName").fill(name);
  await page.locator("#basic-gender").selectOption("FEMALE");
  await page.locator("#basic-birthDate").fill("2001-03-04");
  await page.locator("#basic-field").fill(field);
}
const save = (page: Page) => page.getByTestId("save-candidate").click();
const idOf = async (name: string) => (await ownerQuery<{ id: string }>("select id from candidates where full_name = $1", [name]))[0]?.id;
const count = async (table: string, id: string) =>
  Number((await ownerQuery<{ n: string }>(`select count(*) as n from ${table} where candidate_id = $1`, [id]))[0].n);

test("semua bagian terisi dalam satu form lalu tersimpan; halaman detail menampilkan semuanya; audit tanpa isi", async ({ page }) => {
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.goto("/candidates/new");
  for (const s of ["basic", "about", "japan", "contact", "identity", "health", "family", "education", "work", "certificates", "extras"]) {
    await expect(page.getByTestId(`create-section-${s}`)).toBeVisible(); // semua bagian di satu halaman
  }
  const name = `Lengkap ${run}`;
  const NIK = `NIK-${run}`;
  await fillRequired(page, name, "Perawatan lansia (kaigo)");
  await page.locator("#basic-nameKatakana").fill("コウモク");
  await page.locator("#basic-birthPlace").fill("Bandung");
  await page.locator("#basic-maritalStatus").selectOption("SINGLE");
  await page.locator("#basic-heightCm").fill("162");
  await page.locator("#basic-weightKg").fill("51");
  await page.locator("#basic-dominantHand").selectOption("LEFT");
  await page.locator("#about-motivation").fill("Ingin bekerja di Jepang");
  await page.locator("#about-hobby").fill("Membaca");
  await page.locator("#japan-everInJapan").check();
  await page.locator("#japan-japanHistoryNote").fill("Magang 2019-2021");
  await page.locator("#contact-address").fill("Jl. Mawar 5, Bandung");
  await page.locator("#contact-phone").fill(`0812-${run}`);
  await page.locator("#contact-email").fill("lengkap@example.com");
  await page.locator("#identity-nationalId").fill(NIK);
  await page.locator("#identity-passportNumber").fill("B7654321");
  await page.locator("#identity-passportIssuedDate").fill("2024-01-10");
  await page.locator("#identity-passportExpiryDate").fill("2029-01-10");
  await page.locator("#health-visionNote").fill("Normal");
  await page.locator("#health-colorBlind").check();
  await page.locator("#health-medicalNote").fill(`catatan-medis-${run}`);
  await addRow(page, "family");
  await addRow(page, "family");
  await fillRow(page, "family", 0, { relation: "FATHER", name: "Slamet", occupation: "Petani" });
  await fillRow(page, "family", 1, { relation: "MOTHER", name: "Siti", isEmergencyContact: true });
  await addRow(page, "education");
  await addRow(page, "education");
  await fillRow(page, "education", 0, { schoolName: "SMP 1", startYear: "2013", endYear: "2016" });
  await fillRow(page, "education", 1, { schoolName: "SMK Teknik", major: "Mesin", startYear: "2016", endYear: "2019" });
  await addRow(page, "work");
  await fillRow(page, "work", 0, { companyName: "PT Maju", position: "Operator", startDate: "2019-08-01", endDate: "2021-08-01" });
  await addRow(page, "certificates");
  await addRow(page, "certificates");
  await fillRow(page, "certificates", 0, { type: "JLPT", levelOrField: "N4", score: "120" });
  await fillRow(page, "certificates", 1, { type: "SKILL_TEST", levelOrField: "Kaigo" });
  await page.getByTestId("share-checkbox").check();
  await page.getByTestId("share-confirm").check();
  await page.locator("#dataConsentDate").fill("2026-08-10");
  await page.locator("#consentForm").setInputFiles({ name: "formulir.pdf", mimeType: "application/pdf", buffer: PDF });
  await save(page);

  await expect(page).toHaveURL(/\/candidates\/[0-9a-f-]{36}\?added=1/);
  const text = async (section: string) => (await page.getByTestId(`section-${section}`).textContent()) ?? "";
  expect(await text("basic")).toContain(name);
  expect(await text("basic")).toContain("コウモク");
  expect(await text("basic")).toContain("162 cm");
  expect(await text("about")).toContain("Ingin bekerja di Jepang");
  expect(await text("japan")).toContain("Magang 2019-2021");
  expect(await text("contact")).toContain("Jl. Mawar 5, Bandung");
  expect(await text("contact")).toContain("lengkap@example.com");
  expect(await text("identity")).toContain(NIK);
  expect(await text("identity")).toContain("B7654321");
  expect(await text("health")).toContain(`catatan-medis-${run}`);
  expect(await text("family")).toContain("Slamet");
  expect(await text("family")).toContain("Siti");
  expect(await text("education")).toContain("SMK Teknik");
  expect(await text("work")).toContain("PT Maju");
  expect(await text("certificates")).toContain("JLPT");
  await expect(page.getByTestId("row-family")).toHaveCount(2);
  await expect(page.getByTestId("row-education")).toHaveCount(2);
  await expect(page.getByTestId("row-certificates")).toHaveCount(2);
  await expect(page.getByTestId("sharing-state")).toHaveText("Dibagikan ke TSK mitra");
  await expect(page.getByTestId("document-row")).toContainText("Formulir persetujuan data");

  // Audit: hanya NAMA kolom dan jumlah baris, tidak ada isinya
  const id = await idOf(name);
  const [log] = await ownerQuery<{ after: { fields: string[]; rows: Record<string, number>; consentForm: boolean } }>(
    "select after from audit_logs where candidate_id = $1 and action = 'candidate.create'", [id]);
  expect(log.after.rows).toEqual({ family: 2, education: 2, work: 1, certificates: 2 });
  expect(log.after.fields).toEqual(expect.arrayContaining(["fullName", "phone", "nationalId", "medicalNote", "colorBlind"]));
  expect(log.after.consentForm).toBe(true);
  const dump = JSON.stringify(log);
  for (const secret of [name, NIK, `0812-${run}`, `catatan-medis-${run}`, "B7654321", "Slamet", "Jl. Mawar"]) expect(dump).not.toContain(secret);
});

test("hanya isian wajib: tersimpan, tanpa data sensitif dan baris kosong; berbagi bawaan mati", async ({ page }) => {
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.goto("/candidates/new");
  const name = `Minimal ${run}`;
  await fillRequired(page, name);
  await addRow(page, "family"); // baris yang dibiarkan kosong diabaikan server... tetapi required HTML mencegahnya
  await page.getByTestId("create-row-family").first().getByRole("button").click(); // hapus baris
  await expect(page.getByTestId("create-row-family")).toHaveCount(0);
  await save(page);
  await expect(page).toHaveURL(/\/candidates\/[0-9a-f-]{36}\?added=1/);
  await expect(page.getByTestId("sharing-state")).toHaveText("Belum dibagikan");
  const id = await idOf(name);
  expect(await count("candidate_private", id)).toBe(0);
  for (const t of ["candidate_family_members", "candidate_educations", "candidate_work_histories", "candidate_certificates", "candidate_documents"]) expect(await count(t, id)).toBe(0);
  const [log] = await ownerQuery<{ after: { fields: string[]; rows: Record<string, number> } }>("select after from audit_logs where candidate_id = $1 and action = 'candidate.create'", [id]);
  expect(log.after.fields).toEqual(["birthDate", "field", "fullName", "gender"]);
  expect(Object.values(log.after.rows).every((n) => n === 0)).toBe(true);
});

test("tanpa isian wajib form tidak terkirim; validasi server per bagian TIDAK menghapus isian dan tidak menyimpan apa pun", async ({ page }) => {
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.goto("/candidates/new");
  // 1) Wajib kosong: ditolak browser (belum ada permintaan ke server)
  await page.getByTestId("save-candidate").click();
  expect(await page.locator("#basic-fullName").evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await expect(page.getByTestId("form-error")).toHaveCount(0);

  // 2) Isi banyak hal, sebagian tidak valid; lewati validasi browser agar yang diuji validasi SERVER
  const name = `Gagal ${run}`;
  await fillRequired(page, name);
  await page.locator("#about-hobby").fill("Memancing"); // isian valid di bagian lain harus tetap ada
  await page.locator("#contact-phone").fill("0813-111");
  await page.locator("#contact-email").fill("bukan-email");
  await page.locator("#basic-heightCm").fill("99999");
  await addRow(page, "family");
  await fillRow(page, "family", 0, { relation: "FATHER", name: "Ayah" });
  await addRow(page, "family");
  await fillRow(page, "family", 1, { relation: "MOTHER" }); // nama (wajib) kosong
  await addRow(page, "education");
  await fillRow(page, "education", 0, { schoolName: "SMA Uji", startYear: "2019", endYear: "2015" }); // urutan terbalik
  await page.getByTestId("candidate-create-form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
  await page.locator("#contact-email").evaluate((el) => (el as HTMLInputElement).type = "text");
  await save(page);

  const banner = page.getByTestId("form-error");
  await expect(banner).toContainText("Ada isian yang tidak valid");
  for (const p of ["Data dasar", "Kontak dan alamat", "Keluarga (Baris 2)", "Pendidikan (Baris 1)"]) await expect(banner).toContainText(p);
  await expect(banner).not.toContainText("Keluarga (Baris 1)"); // baris yang benar tidak ditandai
  for (const bad of ["#basic-heightCm", "#contact-email"]) await expect(page.locator(bad)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("create-row-family").nth(1).locator("[name$='.name']")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("create-row-education").first().locator("[name$='.endYear']")).toHaveAttribute("aria-invalid", "true");

  // Semua isian TETAP ada: nilai, pilihan, dan jumlah baris
  await expect(page.locator("#basic-fullName")).toHaveValue(name);
  await expect(page.locator("#basic-gender")).toHaveValue("FEMALE");
  await expect(page.locator("#basic-birthDate")).toHaveValue("2001-03-04");
  await expect(page.locator("#about-hobby")).toHaveValue("Memancing");
  await expect(page.locator("#contact-phone")).toHaveValue("0813-111");
  await expect(page.locator("#contact-email")).toHaveValue("bukan-email");
  await expect(page.getByTestId("create-row-family")).toHaveCount(2);
  await expect(page.getByTestId("create-row-family").first().locator("[name$='.name']")).toHaveValue("Ayah");
  await expect(page.getByTestId("create-row-family").nth(1).locator("[name$='.relation']")).toHaveValue("MOTHER");
  await expect(page.getByTestId("create-row-education").first().locator("[name$='.schoolName']")).toHaveValue("SMA Uji");
  expect(await idOf(name)).toBeUndefined(); // tidak ada yang tersimpan

  // 3) Perbaiki yang salah, kirim lagi: berhasil dengan isian yang sama
  await page.locator("#basic-heightCm").fill("165");
  await page.locator("#contact-email").fill("benar@example.com");
  await fillRow(page, "family", 1, { name: "Ibu" });
  await fillRow(page, "education", 0, { endYear: "2022" });
  await save(page);
  await expect(page).toHaveURL(/\/candidates\/[0-9a-f-]{36}\?added=1/);
  const id = await idOf(name);
  expect(await count("candidate_family_members", id)).toBe(2);
  expect(await count("candidate_educations", id)).toBe(1);
  await expect(page.locator("[data-testid=section-about] [data-testid=value-hobby]")).toHaveText("Memancing");
});

test("kegagalan di tengah penyimpanan membatalkan SEMUANYA (kandidat, data sensitif, baris, audit); isian tetap ada", async ({ page }) => {
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.goto("/candidates/new");
  const name = `Atomik ${run}`;
  await fillRequired(page, name);
  await page.locator("#contact-phone").fill(`0813-${run}`);
  await addRow(page, "family");
  await fillRow(page, "family", 0, { relation: "FATHER", name: `Ayah Atomik ${run}` });
  await page.locator("#consentForm").setInputFiles({ name: "formulir.pdf", mimeType: "application/pdf", buffer: PDF });

  // Penyimpanan file (langkah TERAKHIR dalam transaksi) digagalkan: ada FILE di tempat folder organisasi seharusnya berada
  await rm(path.join(ROOT, orgId), { recursive: true, force: true }); // folder organisasi sudah dibuat tes sebelumnya
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, orgId), "penghalang");
  await save(page);
  await expect(page.getByTestId("form-error")).toContainText("Tidak ada data yang tersimpan");

  expect(await idOf(name)).toBeUndefined();
  expect(await ownerQuery("select 1 from candidate_family_members where name = $1", [`Ayah Atomik ${run}`])).toHaveLength(0);
  expect(await ownerQuery("select 1 from candidate_private where phone = $1", [`0813-${run}`])).toHaveLength(0);
  expect(await ownerQuery("select 1 from audit_logs where action = 'candidate.create' and organization_id = $1 and created_at > now() - interval '1 minute' and (after->'rows'->>'family') = '1' and (after->>'consentForm') = 'true'", [orgId])).toHaveLength(0);
  await expect(page.locator("#basic-fullName")).toHaveValue(name); // isian masih ada
  await expect(page.getByTestId("create-row-family")).toHaveCount(1);

  // Penghalang dihapus, kirim lagi tanpa mengetik ulang: tersimpan lengkap
  await rm(path.join(ROOT, orgId), { force: true });
  await save(page);
  await expect(page).toHaveURL(/\/candidates\/[0-9a-f-]{36}\?added=1/);
  const id = await idOf(name);
  expect(await count("candidate_family_members", id)).toBe(1);
  expect(await count("candidate_private", id)).toBe(1);
  expect(await count("candidate_documents", id)).toBe(1);
});

test("tampilan ponsel: tidak ada gulir horizontal, bilah simpan menempel di bawah, tambah baris berfungsi", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.goto("/candidates/new");
  await addRow(page, "family");
  await addRow(page, "certificates");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bar = await page.getByTestId("save-bar").boundingBox();
  const btn = await page.getByTestId("save-candidate").boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(800 + 1); // menempel di dasar layar
  expect(btn!.width).toBeGreaterThan(150); // tombol lebar, mudah ditekan
  // Tetap terlihat walau halaman digulir ke bagian paling atas dan paling bawah
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId("save-candidate")).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByTestId("save-candidate")).toBeInViewport();
});

test("sensei dan TSK tidak bisa membuka form tambah kandidat", async ({ page, browser }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto("/candidates/new");
  await expect(page).toHaveURL(/\/$/);
  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  await tsk.goto("/candidates/new");
  await expect(tsk).toHaveURL(/\/$/);
});
