import { access } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createScratchCandidate, deleteScratchCandidate, login, ownerQuery, unique } from "./helpers";

// Hapus kandidat permanen (v0.3, bagian C). HANYA menghapus kandidat yang dibuat tes ini sendiri; kandidat seed dicoba hapus
// (diblokir) tetapi harus tetap ada. Berkas dokumen diunggah lewat UI ke storage e2e dan harus hilang setelah hapus.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date();
const NAME = `Uji Hapus Permanen ${run}`;
const ROOT = path.resolve(process.env.E2E_STORAGE_DIR ?? `${process.cwd()}/.e2e-docs`);
const PDF = Buffer.from(`%PDF-1.4\n% dokumen uji hapus ${run}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
const exists = (p: string) => access(p).then(() => true, () => false);

let cid = "";
let orgId = "";
let url = "";
let docId = "";

test.beforeAll(async () => {
  const c = await createScratchCandidate({ name: NAME });
  cid = c.id;
  orgId = c.orgId;
  url = `/candidates/${cid}`;
});

test.afterAll(async () => {
  await deleteScratchCandidate(cid); // bila tes gagal sebelum terhapus; bila sudah terhapus tidak berbuat apa-apa
});

const openDialog = async (page: Page) => {
  await page.getByTestId("delete-open").click();
  await expect(page.getByTestId("delete-dialog")).toBeVisible();
};

test("siapkan: dokumen diunggah lewat UI, serta data milik TSK dan penilaian LPK lewat database", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await page.locator("[data-testid=section-documents] > details > summary").click();
  await page.locator("#doc-type").selectOption("PASSPORT");
  await page.locator("#doc-file").setInputFiles({ name: "paspor-hapus.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.locator("[data-testid=form-document-upload] button[type=submit]").click();
  await expect(page.getByTestId("document-row")).toHaveCount(1);
  [{ id: docId }] = await ownerQuery<{ id: string }>("select id from candidate_documents where candidate_id = $1", [cid]);
  expect(await exists(path.join(ROOT, orgId, cid, `${docId}.pdf`))).toBe(true);

  await ownerQuery("insert into candidate_selections (candidate_id, tsk_org_id, decision) select $1, o.id, 'PASSED_CLIENT_INTERVIEW' from organizations o where o.name = 'TSK Demo Tokyo'", [cid]);
  await ownerQuery("insert into candidate_notes (candidate_id, tsk_org_id, body, visibility) select $1, o.id, $2, 'TSK_ONLY' from organizations o where o.name = 'TSK Demo Tokyo'", [cid, `catatan-tsk-${run}`]);
  await ownerQuery(
    "with s as (select set_config('app.user_id', u.id::text, true) from users u where u.email = 'tsk.admin@hashi.test') insert into candidate_assessments (candidate_id, org_id, kind, assessed_on, score_japanese) select $1, u.organization_id, 'TSK_VISIT', current_date - 3, 4 from users u, s where u.email = 'tsk.admin@hashi.test'",
    [cid],
  );
  await ownerQuery(
    "with s as (select set_config('app.user_id', u.id::text, true) from users u where u.email = 'lpk1.admin@hashi.test') insert into candidate_assessments (candidate_id, org_id, kind, assessed_on, score_japanese) select $1, $2, 'LPK_MONTHLY', current_date - 10, 3 from s",
    [cid, orgId],
  );
});

test("dialog: ringkasan jumlah, peringatan data TSK, saran Nonaktifkan; tombol aktif hanya bila nama persis", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await expect(page.getByTestId("danger-zone")).toBeVisible();
  await openDialog(page);
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog.getByTestId("delete-name")).toHaveText(NAME);
  const count = async (key: string) => Number(await dialog.locator(`[data-key=${key}]`).getAttribute("data-count"));
  expect({ d: await count("documents"), l: await count("assessmentsLpk"), t: await count("assessmentsTsk"), n: await count("notes"), s: await count("selections") }).toEqual({ d: 1, l: 1, t: 1, n: 1, s: 1 });
  await expect(dialog).toContainText("tidak bisa dibatalkan");
  await expect(dialog).toContainText("Nonaktifkan");
  await expect(dialog.getByTestId("delete-tsk-warning")).toBeVisible();

  const submit = dialog.getByTestId("delete-submit");
  const input = dialog.getByTestId("delete-confirm-input");
  await expect(submit).toBeDisabled();
  await input.fill("Nama Salah");
  await expect(submit).toBeDisabled();
  await input.fill(NAME.slice(0, -1)); // kurang satu huruf
  await expect(submit).toBeDisabled();
  await input.fill(NAME.toLowerCase()); // huruf besar/kecil harus persis
  await expect(submit).toBeDisabled();
  await input.fill(NAME);
  await expect(submit).toBeEnabled();
  await input.fill(`${NAME}x`);
  await expect(submit).toBeDisabled();
  await dialog.getByTestId("delete-cancel").click();
  await expect(dialog).toBeHidden();
  expect(await ownerQuery("select 1 from candidates where id = $1", [cid])).toHaveLength(1);
});

test("sensei, TSK, dan LPK lain tidak melihat tombol hapus; pemanggilan action langsung ditolak (kandidat tetap ada)", async ({ page, browser }) => {
  // Admin: ambil field form (termasuk ID action Next) dari dialog, sebagai bahan pemanggilan langsung
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  const fields = await page.locator("[data-testid=delete-dialog] form input[type=hidden]").evaluateAll((els) => els.map((e) => [(e as HTMLInputElement).name, (e as HTMLInputElement).value] as [string, string]));
  expect(fields.some(([n]) => n.startsWith("$ACTION"))).toBe(true);
  const post = (p: Page, confirm: string) =>
    p.request.post(url, { multipart: { ...Object.fromEntries(fields.filter(([n]) => n !== "candidateId")), candidateId: cid, confirm } });

  // Kontrol positif: cara memanggil langsung benar-benar sampai ke action (admin + teks salah -> pesan konfirmasi)
  const control = await post(page, "salah");
  expect(await control.text()).toContain("Teks konfirmasi tidak cocok");

  const before = Number((await ownerQuery<{ n: string }>("select count(*) as n from audit_logs where candidate_id = $1 and action = 'candidate.delete'", [cid]))[0].n);
  for (const email of ["lpk1.sensei@hashi.test", "tsk.admin@hashi.test", "tsk.staff@hashi.test", "lpk2.admin@hashi.test"]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, email);
    const res = await p.goto(url);
    if (email.startsWith("lpk2")) expect(res?.status()).toBe(404); // LPK lain tidak bisa membuka detailnya sama sekali
    else {
      await expect(p.getByTestId("danger-zone")).toHaveCount(0);
      await expect(p.getByTestId("delete-open")).toHaveCount(0);
      const html = await (await p.request.get(url)).text();
      expect(html).not.toContain('data-testid="delete-open"');
      expect(html).not.toContain('data-testid="delete-dialog"');
    }
    await post(p, NAME); // nama BENAR sekalipun: tetap ditolak
    await ctx.close();
  }
  expect(await ownerQuery("select 1 from candidates where id = $1", [cid])).toHaveLength(1);
  expect(await ownerQuery("select 1 from candidate_documents where candidate_id = $1", [cid])).toHaveLength(1);
  expect(Number((await ownerQuery<{ n: string }>("select count(*) as n from audit_logs where candidate_id = $1 and action = 'candidate.delete'", [cid]))[0].n)).toBe(before);
  expect(await exists(path.join(ROOT, orgId, cid, `${docId}.pdf`))).toBe(true);
});

test("kandidat seed dengan keputusan DOCUMENT_PROCESS ditolak dengan pesan yang benar dan tetap ada", async ({ page }) => {
  const [seed] = await ownerQuery<{ id: string; full_name: string }>(
    `select c.id, c.full_name from candidates c join candidate_selections s on s.candidate_id = c.id
     join organizations o on o.id = c.organization_id where o.name = 'LPK Demo Bandung' and s.decision = 'DOCUMENT_PROCESS' limit 1`,
  );
  expect(seed, "seed harus punya kandidat DOCUMENT_PROCESS di Bandung").toBeTruthy();
  const seedUrl = `/candidates/${seed.id}`;
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(seedUrl);
  await openDialog(page);
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog.getByTestId("delete-blocked")).toContainText("tidak bisa dihapus");
  await expect(dialog.getByTestId("delete-submit")).toBeDisabled();
  await expect(dialog.getByTestId("delete-confirm-input")).toHaveCount(0);

  // Dipaksa lewat UI (tombol diaktifkan + nama diisi): server tetap menolak dengan pesan yang sama
  await dialog.evaluate((el, name) => {
    const form = el.querySelector("form")!;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "confirm";
    input.value = name;
    form.appendChild(input);
    form.querySelector<HTMLButtonElement>("[data-testid=delete-submit]")!.disabled = false;
  }, seed.full_name);
  await dialog.getByTestId("delete-submit").click();
  await expect(dialog.getByRole("alert").last()).toContainText("tidak bisa dihapus");
  expect(await ownerQuery("select 1 from candidates where id = $1", [seed.id])).toHaveLength(1);
  expect(await ownerQuery("select 1 from audit_logs where candidate_id = $1 and action = 'candidate.delete'", [seed.id])).toHaveLength(0);
});

test("hapus permanen: kandidat, data turunan, dan berkas hilang; hilang dari daftar, TSK, dan 'belum dinilai'; detail 404; audit tanpa nama", async ({ page, browser }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await openDialog(page);
  const dialog = page.getByTestId("delete-dialog");
  await dialog.getByTestId("delete-confirm-input").fill("Nama Salah");
  await expect(dialog.getByTestId("delete-submit")).toBeDisabled();
  await dialog.getByTestId("delete-confirm-input").fill(NAME);
  await dialog.getByTestId("delete-submit").click();

  await expect(page).toHaveURL(/\/candidates\?deleted=1/);
  await expect(page.getByTestId("candidate-deleted")).toHaveText("Kandidat dihapus permanen.");

  // Basis data: kandidat dan semua turunannya hilang
  expect(await ownerQuery("select 1 from candidates where id = $1", [cid])).toHaveLength(0);
  for (const t of ["candidate_documents", "candidate_assessments", "candidate_notes", "candidate_selections", "candidate_private", "candidate_family_members", "candidate_educations", "candidate_work_histories", "candidate_certificates"]) {
    expect(await ownerQuery(`select 1 from ${t} where candidate_id = $1`, [cid]), t).toHaveLength(0);
  }
  // Berkas dan foldernya hilang dari storage
  expect(await exists(path.join(ROOT, orgId, cid, `${docId}.pdf`))).toBe(false);
  expect(await exists(path.join(ROOT, orgId, cid))).toBe(false);

  // Hilang dari daftar, dari "belum dinilai bulan ini", dan dari tampilan TSK
  await page.goto(`/candidates?q=${encodeURIComponent(NAME)}`);
  await expect(page.getByTestId("candidate-total")).toHaveText("0");
  await page.goto("/assessments/pending");
  await expect(page.getByTestId("pending-row").filter({ hasText: NAME })).toHaveCount(0);
  const ctx = await browser.newContext();
  const tsk = await ctx.newPage();
  await login(tsk, "tsk.admin@hashi.test");
  await tsk.goto(`/candidates?q=${encodeURIComponent(NAME)}`);
  await expect(tsk.getByTestId("candidate-total")).toHaveText("0");
  await ctx.close();

  // Tautan lama: 404, bukan error server
  const gone = await page.goto(url);
  expect(gone?.status()).toBe(404);

  // Audit: bertahan, memuat kode dan jumlah baris, TIDAK memuat nama atau isi catatan
  const audit = await ownerQuery<{ action: string; after: Record<string, unknown> }>(
    "select action, after from audit_logs where candidate_id = $1 and action = 'candidate.delete' and created_at >= $2",
    [cid, startedAt],
  );
  expect(audit).toHaveLength(1);
  const after = audit[0].after as { code: string; deleted: Record<string, number>; filesTotal: number };
  expect(after.code).toBe(cid.slice(0, 8).toUpperCase());
  expect(after.deleted).toMatchObject({ documents: 1, assessmentsLpk: 1, assessmentsTsk: 1, notes: 1, selections: 1 });
  expect(after.filesTotal).toBe(1);
  const raw = JSON.stringify(await ownerQuery("select * from audit_logs where candidate_id = $1", [cid]));
  expect(raw).not.toContain(NAME);
  expect(raw).not.toContain(`catatan-tsk-${run}`);
});
