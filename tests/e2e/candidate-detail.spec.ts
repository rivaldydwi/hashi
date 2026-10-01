import { expect, test, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Halaman detail kandidat (langkah 3, bagian 2). Memakai kandidat demo "Agus Pratama" (LPK Bandung,
// Belajar, belum ada keputusan TSK) dan MEMBERSIHKAN semua perubahan di akhir (afterAll), supaya angka
// data demo yang dipakai tes lain tidak bergeser.

test.describe.configure({ mode: "serial" });

const run = unique();
const PHONE = `0812-SENSITIF-${run}`;
const NIK = `NIK-SENSITIF-${run}`;
const FAMILY = `Keluarga-Sensitif-${run}`;
const SECRET_NOTE = `catatan-rahasia-TSK-${run}`;
const SHARED_NOTE = `catatan-dibagikan-${run}`;
const startedAt = new Date(); // audit log tidak bisa dihapus: hanya periksa baris yang dibuat run ini
let cid = "";
let url = "";

test.beforeAll(async () => {
  const [c] = await ownerQuery<{ id: string }>(
    "select c.id from candidates c join organizations o on o.id = c.organization_id where c.full_name = 'Agus Pratama' and o.name = 'LPK Demo Bandung'",
  );
  cid = c.id;
  url = `/candidates/${cid}`;
  const pre = await ownerQuery("select 1 from candidate_selections where candidate_id = $1", [cid]);
  expect(pre).toHaveLength(0); // prasyarat: belum ada keputusan TSK
});

test.afterAll(async () => {
  for (const sql of [
    "delete from candidate_notes where candidate_id = $1",
    "delete from candidate_selections where candidate_id = $1",
    "delete from candidate_private where candidate_id = $1",
    "delete from candidate_family_members where candidate_id = $1",
    "delete from candidate_educations where candidate_id = $1",
    "update candidates set hobby = null, stage = 'STUDYING' where id = $1",
  ]) await ownerQuery(sql, [cid]);
});

async function openEdit(page: Page, section: string) {
  await page.locator(`[data-testid=section-${section}] > details > summary`).first().click();
}
async function submitAndExpectSaved(page: Page, form: string, message: string) {
  await page.locator(`[data-testid=${form}] button[type=submit]`).click();
  await expect(page.locator(`[data-testid=${form}] p[role=status]`)).toHaveText(message);
}

test("sensei hanya melihat data dasar: data sensitif tidak ada di HTML", async ({ page }) => {
  // Isi data sensitif lebih dulu (lewat database), lalu pastikan sensei tidak pernah menerimanya
  await ownerQuery(
    "insert into candidate_private (candidate_id, national_id, phone, medical_note) values ($1, $2, $3, 'catatan-medis-sensitif') on conflict (candidate_id) do update set national_id = excluded.national_id, phone = excluded.phone",
    [cid, NIK, PHONE],
  );
  await ownerQuery("insert into candidate_family_members (candidate_id, relation, name) values ($1, 'FATHER', $2)", [cid, FAMILY]);
  await ownerQuery(
    "insert into candidate_notes (candidate_id, tsk_org_id, author_id, body, visibility) select $1, u.organization_id, u.id, $2, 'SHARED_WITH_LPK' from users u where u.email = 'tsk.admin@hashi.test'",
    [cid, SHARED_NOTE],
  );

  await login(page, "lpk1.sensei@hashi.test");
  await page.goto("/candidates");
  await page.getByRole("link", { name: "Agus Pratama" }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("section-basic")).toBeVisible();
  await expect(page.getByTestId("section-about")).toBeVisible();

  // Tidak ada di DOM (bukan sekadar disembunyikan CSS)
  for (const s of ["contact", "identity", "health", "japan", "family", "education", "work", "certificates", "decision", "notes"]) {
    await expect(page.locator(`[data-testid=section-${s}]`)).toHaveCount(0);
  }
  // Tidak ada tombol Ubah di bagian data kandidat (bagian Penilaian memang punya form untuk sensei)
  await expect(page.locator("[data-testid^=section-]:not([data-testid=section-assessments]) summary")).toHaveCount(0);

  // Dan tidak ada di HTML mentah yang dikirim server (termasuk payload RSC)
  const html = await (await page.request.get(url)).text();
  // (Label statis seperti "Kontak dan alamat" memang ada di katalog terjemahan yang dikirim ke semua
  // pengguna; yang tidak boleh ada adalah DATA dan bagian sensitif yang dirender.)
  for (const secret of [PHONE, NIK, FAMILY, SHARED_NOTE, "catatan-medis-sensitif", ...["contact", "identity", "health", "family", "decision", "notes"].map((s) => `data-testid="section-${s}"`)]) {
    expect(html, `HTML sensei tidak boleh memuat: ${secret}`).not.toContain(secret);
  }
  expect(html).toContain("Agus Pratama");
});

test("admin LPK melengkapi data per bagian; audit hanya mencatat nama kolom, bukan isinya", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  for (const s of ["basic", "contact", "identity", "health", "family", "education", "work", "certificates", "japan", "about"]) {
    await expect(page.locator(`[data-testid=section-${s}]`)).toBeVisible();
  }
  await expect(page.getByTestId("section-contact")).toContainText(PHONE); // LPK_ADMIN melihat data sensitif

  const newPhone = `0899-BARU-${run}`;
  await openEdit(page, "contact");
  await page.locator("#contact-phone").fill(newPhone);
  await page.locator("#contact-address").fill("Jl. Uji Coba 1, Bandung");
  await submitAndExpectSaved(page, "form-contact", "Perubahan disimpan.");
  await expect(page.locator("[data-testid=section-contact] [data-testid=value-phone]")).toHaveText(newPhone);

  await openEdit(page, "identity");
  await page.locator("#identity-passportNumber").fill("X1234567");
  await page.locator("#identity-passportExpiryDate").fill("2031-05-20");
  await submitAndExpectSaved(page, "form-identity", "Perubahan disimpan.");

  const logs = await ownerQuery<{ action: string; after: { section: string; fields: string[] } }>(
    "select action, after from audit_logs where candidate_id = $1 and created_at >= $2 and action = 'candidate.update' order by created_at",
    [cid, startedAt],
  );
  const contact = logs.find((l) => l.after.section === "contact")!;
  expect(contact.after.fields.sort()).toEqual(["address", "phone"]);
  const identity = logs.find((l) => l.after.section === "identity")!;
  expect(identity.after.fields.sort()).toEqual(["passportExpiryDate", "passportNumber"]);
  const all = JSON.stringify(logs);
  for (const secret of [newPhone, PHONE, "X1234567", "2031-05-20", "Jl. Uji Coba"]) expect(all).not.toContain(secret);

  // Baris berulang: tambah lalu hapus
  await page.locator("[data-testid=section-education] > details > summary").last().click();
  await page.locator("#education-schoolName").fill("SMK Negeri Uji");
  await page.locator("#education-startYear").fill("2015");
  await page.locator("#education-endYear").fill("2018");
  await page.locator("[data-testid=form-education-add] button[type=submit]").click(); // form dikosongkan setelah baris muncul
  await expect(page.getByTestId("section-education")).toContainText("SMK Negeri Uji");
  await page.locator("[data-testid=row-education] summary").first().click();
  await page.locator("[data-testid=form-education-edit]").locator("xpath=..").getByRole("button", { name: "Hapus" }).click();
  await expect(page.getByTestId("section-education")).not.toContainText("SMK Negeri Uji");

  // Status di LPK: ubah lalu kembalikan
  await page.locator("#stage").selectOption("READY");
  await submitAndExpectSaved(page, "form-stage", "Status di LPK diperbarui.");
  await page.locator("#stage").selectOption("STUDYING");
  await submitAndExpectSaved(page, "form-stage", "Status di LPK diperbarui.");
});

test("TSK melihat kandidat yang masih belajar dan mengambil keputusan; data isi baca-saja sebelum PASSED_CLIENT_INTERVIEW", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  await page.goto("/candidates?q=Agus");
  await page.getByRole("link", { name: "Agus Pratama" }).click();
  await expect(page).toHaveURL(url);

  // Bagian sensitif terlihat oleh TSK, tetapi baca-saja dengan penjelasan
  await expect(page.getByTestId("section-contact")).toContainText(`0899-BARU-${run}`);
  await expect(page.getByTestId("readonly-note")).toBeVisible();
  await expect(page.locator("[data-testid^=section-]:not([data-testid=section-notes]) > details")).toHaveCount(0); // tidak ada tombol edit
  await expect(page.locator("#stage")).toHaveCount(0); // status LPK hanya informasi

  await page.locator("#decision").selectOption("SHORTLISTED");
  await submitAndExpectSaved(page, "form-decision", "決定を保存しました。");
  await page.reload();
  await expect(page.locator("#decision")).toHaveValue("SHORTLISTED");
  await expect(page.getByTestId("readonly-note")).toBeVisible(); // SHORTLISTED belum membuka hak edit

  const [cand] = await ownerQuery<{ stage: string }>("select stage from candidates where id = $1", [cid]);
  expect(cand.stage).toBe("STUDYING"); // status LPK tidak ikut berubah
  const [audit] = await ownerQuery<{ organization_id: string; actor_org_id: string; before: { decision: string }; after: { decision: string } }>(
    "select organization_id, actor_org_id, before, after from audit_logs where candidate_id = $1 and created_at >= $2 and action = 'candidate.decision'",
    [cid, startedAt],
  );
  expect(audit.before.decision).toBe("NONE");
  expect(audit.after.decision).toBe("SHORTLISTED");
  expect(audit.organization_id).not.toBe(audit.actor_org_id); // disimpan di log LPK, pelaku = TSK
});

test("TSK bisa mengedit isi data setelah PASSED_CLIENT_INTERVIEW, dan kembali baca-saja bila keputusan diubah", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  await page.goto(url);
  await page.locator("#decision").selectOption("PASSED_CLIENT_INTERVIEW");
  await submitAndExpectSaved(page, "form-decision", "決定を保存しました。");
  await page.reload();
  await expect(page.getByTestId("readonly-note")).toHaveCount(0);

  await openEdit(page, "about");
  await page.locator("#about-hobby").fill(`Hobi-TSK-${run}`);
  await submitAndExpectSaved(page, "form-about", "保存しました。");
  await expect(page.locator("[data-testid=section-about] [data-testid=value-hobby]")).toHaveText(`Hobi-TSK-${run}`);

  const [audit] = await ownerQuery<{ actor_org_id: string; after: { section: string; fields: string[] } }>(
    "select actor_org_id, after from audit_logs where candidate_id = $1 and created_at >= $2 and action = 'candidate.update' and after->>'section' = 'about'",
    [cid, startedAt],
  );
  expect(audit.after.fields).toEqual(["hobby"]);

  await page.locator("#decision").selectOption("SHORTLISTED");
  await submitAndExpectSaved(page, "form-decision", "決定を保存しました。");
  await page.reload();
  await expect(page.getByTestId("readonly-note")).toBeVisible();
  await expect(page.locator("[data-testid=section-about] > details")).toHaveCount(0);
});

test("catatan TSK_ONLY tidak terlihat LPK; yang dibagikan terlihat; hanya penulis atau admin TSK yang bisa mengubah", async ({ page, browser }) => {
  // catatan dibagikan dari beforeAll (SHARED_NOTE) sudah ada. Tambah catatan default lewat UI TSK admin.
  await login(page, "tsk.admin@hashi.test");
  await page.goto(url);
  await page.locator("[data-testid=section-notes] details > summary").last().click();
  await page.locator("#note-body").fill(SECRET_NOTE);
  await expect(page.locator("[data-testid=form-note-add] input[value=TSK_ONLY]")).toBeChecked(); // default: Hanya TSK
  await submitAndExpectSaved(page, "form-note-add", "メモを保存しました。");
  const secret = page.locator("[data-testid=note]", { hasText: SECRET_NOTE });
  await expect(secret).toHaveAttribute("data-visibility", "TSK_ONLY");
  await expect(secret.getByTestId("note-label")).toHaveText("貴機関内のみ閲覧可能");

  // Sisi LPK: hanya yang dibagikan
  const lpk = await (await browser.newContext()).newPage();
  await login(lpk, "lpk1.admin@hashi.test");
  await lpk.goto(url);
  await expect(lpk.getByTestId("section-notes")).toContainText(SHARED_NOTE);
  await expect(lpk.getByTestId("section-notes")).not.toContainText(SECRET_NOTE);
  expect(await (await lpk.request.get(url)).text()).not.toContain(SECRET_NOTE);
  await expect(lpk.locator("[data-testid=section-notes] button")).toHaveCount(0); // LPK tidak bisa mengubah catatan

  // TSK membagikan catatan rahasia -> terlihat LPK; menariknya -> hilang lagi
  await secret.getByRole("button", { name: "LPKに共有する" }).click();
  await expect(secret.getByTestId("note-label")).toHaveText("候補者の所属LPKにも共有中");
  await lpk.reload();
  await expect(lpk.getByTestId("section-notes")).toContainText(SECRET_NOTE);
  await secret.getByRole("button", { name: "貴機関内のみに戻す" }).click();
  await expect(secret.getByTestId("note-label")).toHaveText("貴機関内のみ閲覧可能");
  await lpk.reload();
  await expect(lpk.getByTestId("section-notes")).not.toContainText(SECRET_NOTE);

  // Audit: perubahan visibility tercatat (dari, ke, siapa) tanpa isi catatan
  const logs = await ownerQuery<{ action: string; before: unknown; after: unknown; actor_user_id: string }>(
    "select action, before, after, actor_user_id from audit_logs where candidate_id = $1 and created_at >= $2 and entity = 'candidate_note' order by created_at",
    [cid, startedAt],
  );
  const changes = logs.filter((l) => l.action === "note.visibility_change");
  expect(changes.map((c) => [c.before, c.after])).toEqual([
    [{ visibility: "TSK_ONLY" }, { visibility: "SHARED_WITH_LPK" }],
    [{ visibility: "SHARED_WITH_LPK" }, { visibility: "TSK_ONLY" }],
  ]);
  expect(JSON.stringify(logs)).not.toContain(SECRET_NOTE);
  expect(JSON.stringify(logs)).not.toContain(SHARED_NOTE);

  // Staf TSK: bisa membaca catatan admin tetapi tidak bisa mengubahnya
  const staff = await (await browser.newContext()).newPage();
  await login(staff, "tsk.staff@hashi.test");
  await staff.goto(url);
  const adminNote = staff.locator("[data-testid=note]", { hasText: SECRET_NOTE });
  await expect(adminNote).toBeVisible();
  await expect(adminNote.getByRole("button")).toHaveCount(0);
});
