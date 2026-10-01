import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createIsolatedLpk, login, ownerQuery, unique } from "./helpers";

// Dokumen kandidat (langkah 3, bagian 3). Kandidat demo "Dewi Kusuma" (LPK Bandung, Belajar, belum ada
// keputusan TSK); semua perubahan dibersihkan di akhir. File disimpan di folder e2e sendiri (.e2e-docs).

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date();
const ROOT = path.resolve(process.env.E2E_STORAGE_DIR ?? `${process.cwd()}/.e2e-docs`);
const PDF = Buffer.from(`%PDF-1.4\n% dokumen uji ${run}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png-uji-${run}`)]);
let cid = "";
let orgId = "";
let url = "";
let pdfId = "";

test.beforeAll(async () => {
  const [c] = await ownerQuery<{ id: string; organization_id: string }>(
    "select c.id, c.organization_id from candidates c join organizations o on o.id = c.organization_id where c.full_name = 'Dewi Kusuma' and o.name = 'LPK Demo Bandung'",
  );
  cid = c.id;
  orgId = c.organization_id;
  url = `/candidates/${cid}`;
  expect(await ownerQuery("select 1 from candidate_selections where candidate_id = $1", [cid])).toHaveLength(0);
});

test.afterAll(async () => {
  for (const sql of ["delete from candidate_documents where candidate_id = $1", "delete from candidate_selections where candidate_id = $1"]) await ownerQuery(sql, [cid]);
  await rm(ROOT, { recursive: true, force: true });
});

const docCount = async () => Number((await ownerQuery<{ n: string }>("select count(*) as n from candidate_documents where candidate_id = $1", [cid]))[0].n);
const exists = (p: string) => access(p).then(() => true, () => false);

async function openUpload(page: Page) {
  await page.locator("[data-testid=section-documents] > details > summary").click();
}
async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, type = "PASSPORT") {
  await page.locator("#doc-type").selectOption(type);
  await page.locator("#doc-file").setInputFiles(file);
  await page.locator("[data-testid=form-document-upload] button[type=submit]").click();
}

test("admin LPK mengunggah PDF lalu mengunduhnya; unduhan tercatat di audit dan file tersimpan dengan nama = id", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await openUpload(page);
  await page.locator("#doc-expiry").fill("2020-01-01");
  await upload(page, { name: "paspor-uji.pdf", mimeType: "application/pdf", buffer: PDF });

  const row = page.getByTestId("document-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Paspor");
  await expect(row).toContainText("paspor-uji.pdf");
  await expect(row).toContainText("Kedaluwarsa"); // tanggal berlaku sudah lewat

  const [db] = await ownerQuery<{ id: string; mime_type: string; size_bytes: number; original_filename: string }>(
    "select id, mime_type, size_bytes, original_filename from candidate_documents where candidate_id = $1",
    [cid],
  );
  pdfId = db.id;
  expect(db.mime_type).toBe("application/pdf");
  expect(db.size_bytes).toBe(PDF.length);
  // Di disk: <org>/<kandidat>/<id>.pdf; nama asli dari user tidak dipakai
  const onDisk = path.join(ROOT, orgId, cid, `${pdfId}.pdf`);
  expect(await readFile(onDisk)).toEqual(PDF);
  expect(await exists(path.join(ROOT, orgId, cid, "paspor-uji.pdf"))).toBe(false);

  // Unduh lewat tombol (browser) dan lewat request: isi sama, header aman
  const link = page.getByTestId("document-download");
  const [dl] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(dl.suggestedFilename()).toBe("paspor-uji.pdf");
  const res = await page.request.get(await link.getAttribute("href") as string);
  expect(res.status()).toBe(200);
  expect(Buffer.from(await res.body())).toEqual(PDF);
  expect(res.headers()["content-disposition"]).toMatch(/^attachment; /);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["cache-control"]).toContain("no-store");

  // Audit: tiap unduhan tercatat (2x di atas), hanya id + jenis, tanpa isi file
  const logs = await ownerQuery<{ action: string; entity_id: string; actor_org_id: string; organization_id: string; after: Record<string, unknown> }>(
    "select action, entity_id, actor_org_id, organization_id, after from audit_logs where candidate_id = $1 and created_at >= $2 and entity_id = $3 order by created_at",
    [cid, startedAt, pdfId],
  );
  expect(logs.filter((l) => l.action === "document.upload")).toHaveLength(1);
  const downloads = logs.filter((l) => l.action === "document.download");
  expect(downloads).toHaveLength(2);
  expect(downloads[0].after).toEqual({ type: "PASSPORT" });
  expect(downloads[0].actor_org_id).toBe(downloads[0].organization_id);
  expect(JSON.stringify(logs)).not.toContain("dokumen uji");
  expect(JSON.stringify(logs)).not.toContain("paspor-uji");
});

test("file palsu, terlalu besar, dan nama file berbahaya ditangani dengan aman", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await openUpload(page);
  const before = await docCount();
  const alert = () => page.locator("[data-testid=form-document-upload] p[role=alert]");

  // Ekstensi .pdf dan Content-Type pdf, tetapi isinya HTML -> ditolak (dicek dari isi)
  await upload(page, { name: "palsu.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await expect(alert()).toHaveText("File bukan PDF, JPG, atau PNG yang valid.");
  // Program (MZ) berkedok .png
  await upload(page, { name: "virus.png", mimeType: "image/png", buffer: Buffer.from("MZ\x90\x00\x03\x00\x00\x00") });
  await expect(alert()).toHaveText("File bukan PDF, JPG, atau PNG yang valid.");
  expect(await docCount()).toBe(before);

  // > 10 MB: browser menolak lebih dulu (setCustomValidity); lalu ditolak server bila validasi browser dilewati
  const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
  await page.locator("#doc-type").selectOption("OTHER");
  await page.locator("#doc-file").setInputFiles({ name: "besar.pdf", mimeType: "application/pdf", buffer: big });
  expect(await page.locator("#doc-file").evaluate((el) => (el as HTMLInputElement).validity.customError)).toBe(true);
  await page.locator("#doc-file").evaluate((el) => (el as HTMLInputElement).setCustomValidity(""));
  await page.locator("[data-testid=form-document-upload] button[type=submit]").click();
  await expect(alert()).toHaveText("Ukuran file melebihi 10 MB.");
  expect(await docCount()).toBe(before);

  // PNG asli tetapi berekstensi .jpg dan nama berisi path traversal: diterima sebagai PNG, nama dibersihkan, tetap di dalam folder
  await upload(page, { name: "../../../evil.jpg", mimeType: "image/jpeg", buffer: PNG }, "PHOTO");
  await expect(page.getByTestId("document-row")).toHaveCount(2);
  const [png] = await ownerQuery<{ id: string; mime_type: string; original_filename: string }>(
    "select id, mime_type, original_filename from candidate_documents where candidate_id = $1 and type = 'PHOTO'",
    [cid],
  );
  expect(png.mime_type).toBe("image/png"); // ditentukan dari isi, bukan ekstensi/Content-Type kiriman
  expect(png.original_filename).not.toMatch(/[\\/]|\.\./);
  expect(await exists(path.join(ROOT, orgId, cid, `${png.id}.png`))).toBe(true);
  expect(await exists(path.join(ROOT, "..", "evil.jpg"))).toBe(false);
  expect(await exists(path.join(ROOT, "evil.jpg"))).toBe(false);
});

test("sensei tidak punya akses ke dokumen: tidak ada di halaman, dan URL unduh langsung ditolak", async ({ page, browser }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto(url);
  await expect(page.getByTestId("section-basic")).toBeVisible();
  await expect(page.locator("[data-testid=section-documents]")).toHaveCount(0);
  const html = await (await page.request.get(url)).text();
  for (const s of ['data-testid="section-documents"', "paspor-uji.pdf", `/documents/${pdfId}`]) expect(html).not.toContain(s);

  const direct = await page.request.get(`${url}/documents/${pdfId}`);
  expect(direct.status()).toBe(403);

  // Tanpa login -> 401; LPK lain (bukan pemilik) -> 404
  const anon = await (await browser.newContext()).newPage();
  expect((await anon.request.get(`${url}/documents/${pdfId}`)).status()).toBe(401);
  const other = await (await browser.newContext()).newPage();
  await login(other, "lpk2.admin@hashi.test");
  expect((await other.request.get(`${url}/documents/${pdfId}`)).status()).toBe(404);
  // ID acak / bukan UUID
  expect((await other.request.get(`${url}/documents/bukan-uuid`)).status()).toBe(404);
});

test("TSK melihat dan mengunduh dokumen, tetapi baru bisa mengunggah/menghapus setelah PASSED_CLIENT_INTERVIEW", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  await page.goto(url);
  await expect(page.getByTestId("document-row")).toHaveCount(2);
  const res = await page.request.get(`${url}/documents/${pdfId}`);
  expect(res.status()).toBe(200);
  expect(Buffer.from(await res.body())).toEqual(PDF);
  const [tskLog] = await ownerQuery<{ actor_org_id: string; organization_id: string }>(
    "select actor_org_id, organization_id from audit_logs where candidate_id = $1 and created_at >= $2 and action = 'document.download' and actor_org_id <> organization_id",
    [cid, startedAt],
  );
  expect(tskLog).toBeTruthy(); // unduhan TSK tercatat di log LPK pemilik dengan pelaku = TSK

  // Belum ada keputusan yang membuka hak edit: tidak ada form unggah maupun tombol hapus
  await expect(page.locator("[data-testid=form-document-upload]")).toHaveCount(0);
  await expect(page.locator("[data-testid=section-documents] button")).toHaveCount(0);

  // Keputusan PASSED_CLIENT_INTERVIEW membuka hak edit: unggah lalu hapus
  await ownerQuery(
    "insert into candidate_selections (candidate_id, tsk_org_id, decision) select $1, u.organization_id, 'PASSED_CLIENT_INTERVIEW' from users u where u.email = 'tsk.admin@hashi.test'",
    [cid],
  );
  await page.reload();
  await openUpload(page);
  await upload(page, { name: "visa.png", mimeType: "image/png", buffer: PNG }, "VISA");
  await expect(page.getByTestId("document-row")).toHaveCount(3);
  const [visa] = await ownerQuery<{ id: string }>("select id from candidate_documents where candidate_id = $1 and type = 'VISA'", [cid]);
  const visaFile = path.join(ROOT, orgId, cid, `${visa.id}.png`);
  expect(await exists(visaFile)).toBe(true);
  await page.locator("[data-testid=document-row]", { hasText: "visa.png" }).getByRole("button", { name: "削除" }).click();
  await expect(page.getByTestId("document-row")).toHaveCount(2);
  expect(await exists(visaFile)).toBe(false); // file di disk ikut terhapus
  expect(await docCount()).toBe(2);
});

test("form tambah kandidat: formulir persetujuan opsional; file tidak valid membatalkan penambahan", async ({ page, browser }) => {
  const lpk = await createIsolatedLpk(browser);
  await login(page, lpk.adminEmail, lpk.adminPassword);
  const fill = async (name: string) => {
    await page.goto("/candidates/new");
    await page.locator("#basic-fullName").fill(name);
    await page.locator("#basic-gender").selectOption("FEMALE");
    await page.locator("#basic-birthDate").fill("2002-02-02");
    await page.locator("#basic-field").fill("Konstruksi");
    await page.locator("#dataConsentDate").fill("2026-08-05");
  };

  const bad = `Form Palsu ${run}`;
  await fill(bad);
  await page.locator("#consentForm").setInputFiles({ name: "persetujuan.pdf", mimeType: "application/pdf", buffer: Buffer.from("bukan pdf") });
  await page.locator("main form button[type=submit]").click();
  await expect(page.getByTestId("form-error")).toHaveText("File bukan PDF, JPG, atau PNG yang valid.");
  expect(await ownerQuery("select 1 from candidates where full_name = $1", [bad])).toHaveLength(0);

  const good = `Form Sah ${run}`;
  await fill(good);
  await page.locator("#consentForm").setInputFiles({ name: "persetujuan.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.locator("main form button[type=submit]").click();
  await expect(page).toHaveURL(/\/candidates\/[0-9a-f-]{36}\?added=1/); // tetap diarahkan ke halaman detail
  await expect(page.getByTestId("document-row")).toHaveCount(1);
  await expect(page.getByTestId("document-row")).toContainText("Formulir persetujuan data");
  const [d] = await ownerQuery<{ type: string; issued: string }>(
    "select d.type, to_char(d.issued_date, 'YYYY-MM-DD') as issued from candidate_documents d join candidates c on c.id = d.candidate_id where c.full_name = $1",
    [good],
  );
  expect(d.type).toBe("DATA_CONSENT_FORM");
  expect(d.issued).toBe("2026-08-05");
});
