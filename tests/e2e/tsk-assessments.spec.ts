import { expect, test, type Page } from "@playwright/test";
import { todayInTskTz } from "../../src/db/time";
import { createScratchCandidate, createScratchJobOrder, deleteScratchCandidate, deleteScratchJobOrder, login, ownerQuery, unique } from "./helpers";

// Penilaian TSK (langkah 4, bagian C). Kandidat uji SENDIRI (LPK Bandung, dibagikan ke TSK, belum ada keputusan
// TSK dan belum pernah dinilai), dihapus di akhir; audit tidak bisa dihapus, jadi dibatasi created_at.
// tsk.staff berlocale Indonesia (teks bisa diperiksa); tsk.admin berlocale Jepang (dipakai lewat testid / id saja).

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date();
const SECRET = `rahasia-kunjungan-${run}`;
const INTERVIEW_NOTE = `catatan-interview-${run}`;
const ADMIN_NOTE = `catatan-admin-tsk-${run}`;
const today = todayInTskTz();
const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
let cid = "";
let url = "";
let tskOrg = "";
let jo: Awaited<ReturnType<typeof createScratchJobOrder>>;

test.beforeAll(async () => {
  cid = (await createScratchCandidate({ name: `Uji TSK ${run}` })).id;
  url = `/candidates/${cid}`;
  const [o] = await ownerQuery<{ id: string }>("select o.id from users u join organizations o on o.id = u.organization_id where u.email = 'tsk.staff@hashi.test'");
  tskOrg = o.id;
  jo = await createScratchJobOrder({ tag: `nilai${run}` });
  await ownerQuery(
    // trigger mengisi penilai dari app.user_id: set di CTE yang dirujuk insert supaya berjalan lebih dulu
    "with s as (select set_config('app.user_id', u.id::text, true) from users u where u.email = 'lpk1.admin@hashi.test') insert into candidate_assessments (candidate_id, org_id, kind, assessed_on, score_japanese, note) select c.id, c.organization_id, 'LPK_MONTHLY', current_date - 40, 3, 'catatan LPK bulanan' from candidates c, s where c.id = $1",
    [cid],
  );
});

test.afterAll(async () => {
  await deleteScratchCandidate(cid);
  await deleteScratchJobOrder(jo);
});

/** Ganti keputusan TSK atas kandidat uji: satu baris saja; job order dilampirkan bila keputusan mewajibkannya. */
async function setDecisionSql(decision: string) {
  await ownerQuery("delete from candidate_selections where candidate_id = $1", [cid]);
  const needs = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"].includes(decision);
  await ownerQuery("insert into candidate_selections (candidate_id, tsk_org_id, decision, job_order_id) values ($1, $2, $3, $4)", [cid, tskOrg, decision, needs ? jo.id : null]);
}

async function fill(page: Page, prefix: string, v: { date?: string; scores?: string[]; note?: string; visibility?: "TSK_ONLY" | "SHARED_WITH_LPK" }) {
  const form = page.locator(`[data-testid=form-${prefix}]`);
  if (v.date) await form.locator(`#${prefix}-assessedOn`).fill(v.date);
  const names = ["scoreJapanese", "scoreAttitude", "scoreFitness", "scoreMotivation"];
  for (const [i, s] of (v.scores ?? []).entries()) await form.locator(`#${prefix}-${names[i]}`).selectOption(s);
  if (v.note !== undefined) await form.locator(`#${prefix}-note`).fill(v.note);
  if (v.visibility) await form.locator(`input[name=visibility][value=${v.visibility}]`).check();
  return form;
}
const openVisit = (page: Page) => page.getByTestId("tsk-visit-toggle").click();

test("TSK: penilaian LPK tampil baca-saja; kunjungan selalu tersedia, interview terkunci sebelum keputusan yang sesuai", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(url);
  // Penilaian bulanan LPK: ada, tetapi tanpa form tambah / ubah
  const lpk = page.getByTestId("section-assessments");
  await expect(lpk).toContainText("Hanya baca");
  await expect(lpk.getByTestId("assessment-row")).toHaveCount(1);
  await expect(page.getByTestId("assessment-add-toggle")).toHaveCount(0);
  await expect(page.getByTestId("form-assessment-add")).toHaveCount(0);
  await expect(page.getByTestId("form-assessment-edit")).toHaveCount(0);

  // Kunjungan tersedia; interview terkunci dengan penjelasan (bukan form)
  await expect(page.getByTestId("tsk-visit-toggle")).toBeVisible();
  await expect(page.getByTestId("tsk-interview-toggle")).toHaveCount(0);
  await expect(page.getByTestId("tsk-interview-locked")).toContainText("Lulus wawancara TSK");
  await expect(page.locator("[data-testid=form-tsk-interview]")).toHaveCount(0);
});

test("TSK menambah kunjungan (bawaan Hanya TSK): LPK dan sensei tidak melihatnya, termasuk di HTML mentah", async ({ page, browser }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(url);
  await openVisit(page);
  await expect(page.locator("#tsk-visit-assessedOn")).toHaveValue(today); // default hari ini (Tokyo)
  await expect(page.locator("input[name=visibility][value=TSK_ONLY]").first()).toBeChecked();
  const form = await fill(page, "tsk-visit", { scores: ["4", "5", "3", "4"], note: SECRET });
  await form.getByTestId("assessment-submit").click();
  const item = page.getByTestId("tsk-assessment");
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute("data-kind", "TSK_VISIT");
  await expect(item).toHaveAttribute("data-visibility", "TSK_ONLY");
  await expect(item.getByTestId("tsk-assessment-note")).toHaveText(SECRET);
  await expect(item).toContainText("4.0"); // (4+5+3+4)/4

  for (const [email, label] of [["lpk1.admin@hashi.test", "admin LPK"], ["lpk1.sensei@hashi.test", "sensei"]] as const) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, email);
    await p.goto(url);
    await expect(p.getByTestId("section-tsk-assessments"), `${label}: bagian disembunyikan bila kosong`).toHaveCount(0);
    const html = await (await p.request.get(url)).text();
    expect(html, `${label}: HTML tidak boleh memuat catatan TSK`).not.toContain(SECRET);
    await ctx.close();
  }
});

test("TSK membagikan ke LPK: hanya Admin LPK yang melihat (baca saja); sensei tetap tidak; mencabut menyembunyikan lagi", async ({ page, browser }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(url);
  await page.locator("[data-testid=tsk-assessment] summary").click();
  const edit = await fill(page, `tsk-visit-${(await ownerQuery<{ id: string }>("select id from candidate_assessments where candidate_id = $1 and kind = 'TSK_VISIT'", [cid]))[0].id.slice(0, 8)}`, { visibility: "SHARED_WITH_LPK" });
  await edit.getByTestId("assessment-submit").click();
  await expect(page.getByTestId("tsk-assessment")).toHaveAttribute("data-visibility", "SHARED_WITH_LPK");

  const admin = await browser.newContext();
  const a = await admin.newPage();
  await login(a, "lpk1.admin@hashi.test");
  await a.goto(url);
  const sec = a.getByTestId("section-tsk-assessments");
  await expect(sec).toBeVisible();
  await expect(sec).toContainText("Penilaian dari TSK");
  await expect(sec.getByTestId("tsk-assessment-note")).toHaveText(SECRET);
  await expect(sec.locator("form")).toHaveCount(0); // baca saja
  await expect(sec.locator("summary")).toHaveCount(0);
  await admin.close();

  const sensei = await browser.newContext();
  const s = await sensei.newPage();
  await login(s, "lpk1.sensei@hashi.test");
  await s.goto(url);
  await expect(s.getByTestId("section-tsk-assessments")).toHaveCount(0);
  expect(await (await s.request.get(url)).text()).not.toContain(SECRET);
  await sensei.close();

  // Dicabut lagi: LPK tidak melihatnya lagi
  await ownerQuery("update candidate_assessments set visibility = 'TSK_ONLY' where candidate_id = $1 and kind = 'TSK_VISIT'", [cid]);
  const admin2 = await browser.newContext();
  const a2 = await admin2.newPage();
  await login(a2, "lpk1.admin@hashi.test");
  await a2.goto(url);
  await expect(a2.getByTestId("section-tsk-assessments")).toHaveCount(0);
  await admin2.close();
});

test("hak ubah: staf tidak bisa mengubah penilaian TSK_ADMIN; TSK_ADMIN bisa mengubah milik staf", async ({ page, browser }) => {
  // Penilaian milik admin TSK (dibuat lewat database), lalu dilihat staf
  await ownerQuery(
    "with s as (select set_config('app.user_id', u.id::text, true) from users u where u.email = 'tsk.admin@hashi.test') insert into candidate_assessments (candidate_id, org_id, kind, assessed_on, score_japanese, note) select $1, $2, 'TSK_VISIT', current_date - 1, 5, $3 from s",
    [cid, tskOrg, ADMIN_NOTE],
  );
  await login(page, "tsk.staff@hashi.test");
  await page.goto(url);
  const items = page.getByTestId("tsk-assessment");
  await expect(items).toHaveCount(2);
  const adminItem = items.filter({ hasText: ADMIN_NOTE });
  await expect(adminItem.locator("summary")).toHaveCount(0); // bukan penilainya, bukan TSK_ADMIN
  await expect(items.filter({ hasText: SECRET }).locator("summary")).toHaveCount(1);

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, "tsk.admin@hashi.test");
  await p.goto(url);
  await expect(p.getByTestId("tsk-assessment")).toHaveCount(2);
  await expect(p.getByTestId("tsk-assessment").locator("summary")).toHaveCount(2); // TSK_ADMIN boleh mengubah keduanya
  await ctx.close();
});

test("interview: terbuka setelah keputusan yang sesuai; server menolak bila keputusan berubah; kembali terkunci", async ({ page }) => {
  await setDecisionSql("SHORTLISTED");
  await login(page, "tsk.staff@hashi.test");
  await page.goto(url);
  await expect(page.getByTestId("tsk-interview-locked")).toBeVisible(); // SHORTLISTED belum cukup

  await setDecisionSql("PASSED_TSK_INTERVIEW");
  await page.goto(url);
  await expect(page.getByTestId("tsk-interview-locked")).toHaveCount(0);
  await page.getByTestId("tsk-interview-toggle").click();
  const form = await fill(page, "tsk-interview", { scores: ["5", "4", "4", "5"], note: INTERVIEW_NOTE, visibility: "SHARED_WITH_LPK" });

  // Keputusan dicabut SETELAH halaman dimuat: server (dan RLS) tetap menolak
  await setDecisionSql("SHORTLISTED");
  await form.getByTestId("assessment-submit").click();
  await expect(form.getByRole("alert")).toContainText("Interview hanya bisa dicatat");
  expect(await ownerQuery("select 1 from candidate_assessments where candidate_id = $1 and kind = 'TSK_INTERVIEW'", [cid])).toHaveLength(0);

  // Dipulihkan: berhasil, tampil sebagai interview dan dibagikan
  await setDecisionSql("DOCUMENT_PROCESS");
  await form.getByTestId("assessment-submit").click();
  const item = page.locator("[data-testid=tsk-assessment][data-kind=TSK_INTERVIEW]");
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute("data-visibility", "SHARED_WITH_LPK");
  await expect(item).toContainText("4.5");

  // Keputusan turun lagi: interview yang sudah ada tetap tampil, form baru terkunci
  await setDecisionSql("REJECTED");
  await page.goto(url);
  await expect(page.getByTestId("tsk-interview-locked")).toBeVisible();
  await expect(page.locator("[data-testid=tsk-assessment][data-kind=TSK_INTERVIEW]")).toHaveCount(1);
});

test("tanggal besok (Tokyo) ditolak server; penilaian TSK sampai ke LPK_ADMIN hanya yang dibagikan", async ({ page, browser }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(url);
  await openVisit(page);
  await page.locator("#tsk-visit-assessedOn").evaluate((el) => el.removeAttribute("max"));
  const form = await fill(page, "tsk-visit", { date: tomorrow, scores: ["3", "3", "3", "3"], note: "tidak boleh tersimpan" });
  await form.getByTestId("assessment-submit").click();
  await expect(form.getByRole("alert")).toContainText("tidak boleh di masa depan");
  await expect(page.getByTestId("tsk-assessment")).toHaveCount(3);

  // LPK_ADMIN: hanya interview yang dibagikan (kunjungan masih Hanya TSK)
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await login(a, "lpk1.admin@hashi.test");
  await a.goto(url);
  const items = a.getByTestId("section-tsk-assessments").getByTestId("tsk-assessment");
  await expect(items).toHaveCount(1);
  await expect(items).toHaveAttribute("data-kind", "TSK_INTERVIEW");
  await expect(items.getByTestId("tsk-assessment-note")).toHaveText(INTERVIEW_NOTE);
  await ctx.close();
});

test("audit penilaian TSK memuat jenis, kolom, dan visibility; tidak pernah isi catatan", async () => {
  const rows = await ownerQuery<{ action: string; before: unknown; after: unknown }>(
    "select action, before, after from audit_logs where candidate_id = $1 and action like 'assessment.%' and created_at >= $2",
    [cid, startedAt],
  );
  expect(rows.length).toBeGreaterThanOrEqual(3);
  const text = JSON.stringify(rows);
  for (const secret of [SECRET, INTERVIEW_NOTE, ADMIN_NOTE]) expect(text).not.toContain(secret);
  expect(text).toContain("TSK_VISIT");
  expect(text).toContain("SHARED_WITH_LPK");
  // skor penilaian TSK (bisa TSK_ONLY) tidak boleh masuk log yang dibaca LPK
  expect(text).not.toMatch(/\"score[A-Za-z]+\":/); // nama kolom di `fields` boleh, nilai skor tidak
});
