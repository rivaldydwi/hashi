import { expect, test, type Page } from "@playwright/test";
import { periodMonthsAgo, todayInAppTz } from "../../src/db/time";
import { login, ownerQuery, unique } from "./helpers";

// Penilaian bulanan LPK (langkah 4, bagian B). Kandidat demo "Agus Pratama" (LPK Bandung): kandidat pertama tiap
// LPK di seed sengaja belum pernah dinilai. Semua data uji dibersihkan di akhir (afterAll); audit tidak bisa dihapus,
// jadi pemeriksaan audit dibatasi ke baris sejak tes dimulai.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date();
const SECRET_MEDICAL = `medis-rahasia-${run}`;
const SECRET_NOTE = `catatan-bulan-ini-${run}`;
let cid = "";
let url = "";

const today = todayInAppTz();
const thisMonthDate = today;
const lastMonthDate = `${periodMonthsAgo(1).slice(0, 7)}-15`;
const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  const [c] = await ownerQuery<{ id: string }>(
    "select c.id from candidates c join organizations o on o.id = c.organization_id where c.full_name = 'Agus Pratama' and o.name = 'LPK Demo Bandung'",
  );
  cid = c.id;
  url = `/candidates/${cid}`;
  expect(await ownerQuery("select 1 from candidate_assessments where candidate_id = $1", [cid])).toHaveLength(0); // prasyarat: belum pernah dinilai
});

test.afterAll(async () => {
  await ownerQuery("delete from candidate_assessments where candidate_id = $1", [cid]);
  await ownerQuery("delete from candidate_certificates where candidate_id = $1 and level_or_field = $2", [cid, `N4-${run}`]);
  await ownerQuery("delete from candidate_private where candidate_id = $1", [cid]);
});

async function fillAndSave(page: Page, v: { date: string; scores: [string, string, string, string]; attendance: string; note?: string }) {
  const form = page.getByTestId("form-assessment-add");
  if (!(await form.isVisible())) await page.getByTestId("assessment-add-toggle").click();
  await form.locator("#assessment-assessedOn").fill(v.date);
  const names = ["scoreJapanese", "scoreAttitude", "scoreFitness", "scoreMotivation"];
  for (const [i, n] of names.entries()) await form.locator(`#assessment-${n}`).selectOption(v.scores[i]);
  await form.locator("#assessment-attendancePct").fill(v.attendance);
  await form.locator("#assessment-note").fill(v.note ?? "");
  await form.getByTestId("assessment-submit").click();
}

test("daftar belum dinilai: Agus muncul, hitungan di beranda sama; TSK dan super admin tidak punya halamannya", async ({ page, browser }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto("/");
  const dash = Number(await page.getByTestId("pending-count").textContent());
  await page.goto("/assessments/pending");
  const total = Number(await page.getByTestId("pending-total").textContent());
  expect(total).toBe(dash);
  expect(total).toBeGreaterThan(0);
  await expect(page.getByTestId("pending-row").filter({ hasText: "Agus Pratama" })).toHaveCount(1);
  await expect(page.getByTestId("pending-row").filter({ hasText: "belum pernah dinilai" }).first()).toBeVisible();

  for (const email of ["tsk.admin@hashi.test", "admin@hashi.test"]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, email).catch(() => {});
    await p.goto("/assessments/pending");
    await expect(p.getByTestId("pending-list")).toHaveCount(0);
    await expect(p).not.toHaveURL(/assessments\/pending/);
    await ctx.close();
  }
});

test("sensei menambah penilaian: tanggal default hari ini (Jakarta) diterima, riwayat, rata-rata, dan tren benar", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto(url);
  const section = page.getByTestId("section-assessments");
  await expect(section).toBeVisible();
  await expect(section).toContainText("Jangan menulis diagnosis atau data medis di sini");
  await expect(page.locator("#assessment-assessedOn")).toHaveValue(today); // default = hari ini menurut APP_TIMEZONE
  await expect(page.locator("#assessment-durationMinutes")).toHaveValue("30");
  await expect(page.locator("#assessment-scoreFitness")).toBeVisible();
  await expect(section.locator("label", { hasText: "Kebugaran" })).toHaveCount(1);

  // Bulan lalu dulu (rata-rata 2.0), lalu bulan ini (4.0, tanggal default hari ini: tidak boleh ditolak)
  await fillAndSave(page, { date: lastMonthDate, scores: ["2", "2", "2", "2"], attendance: "70" });
  await expect(page.getByTestId("assessment-row")).toHaveCount(1);
  await fillAndSave(page, { date: thisMonthDate, scores: ["4", "4", "4", "4"], attendance: "90", note: SECRET_NOTE });
  await expect(page.getByTestId("assessment-row")).toHaveCount(2);

  const rows = page.getByTestId("assessment-row");
  await expect(rows.nth(0).getByTestId("assessment-avg")).toHaveText("4.0"); // terbaru di atas
  await expect(rows.nth(0).getByTestId("assessment-trend")).toHaveAttribute("data-trend", "up");
  await expect(rows.nth(1).getByTestId("assessment-avg")).toHaveText("2.0");
  await expect(rows.nth(1).getByTestId("assessment-trend")).toHaveCount(0); // yang tertua tidak punya pembanding
  await expect(section.getByTestId("assessment-note").first()).toHaveText(SECRET_NOTE);

  const [row] = await ownerQuery<{ assessor_id: string; email: string }>(
    "select a.assessor_id, u.email from candidate_assessments a join users u on u.id = a.assessor_id where a.candidate_id = $1 and a.assessed_on = $2",
    [cid, thisMonthDate],
  );
  expect(row.email).toBe("lpk1.sensei@hashi.test"); // penilai = user yang login
});

test("bulan yang sama ditolak dengan pesan jelas; tanggal masa depan ditolak server", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto(url);
  await fillAndSave(page, { date: thisMonthDate, scores: ["5", "5", "5", "5"], attendance: "100" });
  await expect(page.getByTestId("form-assessment-add").getByRole("alert")).toContainText("sudah punya penilaian bulanan");
  await expect(page.getByTestId("assessment-row")).toHaveCount(2);

  // Batas `max` di input dilepas supaya yang diuji adalah penolakan di server, bukan validasi browser
  await page.locator("#assessment-assessedOn").evaluate((el) => el.removeAttribute("max"));
  await fillAndSave(page, { date: tomorrow, scores: ["5", "5", "5", "5"], attendance: "100" });
  await expect(page.getByTestId("form-assessment-add").getByRole("alert")).toContainText("tidak boleh di masa depan");
  await expect(page.getByTestId("assessment-row")).toHaveCount(2);
});

test("Agus hilang dari daftar belum dinilai dan hitungan beranda turun", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto("/assessments/pending");
  await expect(page.getByTestId("pending-row").filter({ hasText: "Agus Pratama" })).toHaveCount(0);
  const total = Number(await page.getByTestId("pending-total").textContent());
  await page.goto("/");
  expect(Number(await page.getByTestId("pending-count").textContent())).toBe(total);
  const [{ n }] = await ownerQuery<{ n: string }>(
    `select count(*)::text as n from candidates c join organizations o on o.id = c.organization_id
     where o.name = 'LPK Demo Bandung' and c.stage in ('STUDYING','READY')
       and not exists (select 1 from candidate_assessments a where a.candidate_id = c.id and a.kind = 'LPK_MONTHLY' and a.period = $1)`,
    [`${today.slice(0, 7)}-01`],
  );
  expect(total).toBe(Number(n)); // sama dengan hitungan independen dari database
});

test("filter nilai, kehadiran, dan JLPT di /candidates; kolom nilai terakhir", async ({ page }) => {
  await ownerQuery("insert into candidate_certificates (candidate_id, type, level_or_field) values ($1, 'JLPT', $2)", [cid, `N4-${run}`]);
  await login(page, "lpk1.admin@hashi.test");
  const listed = async (qs: string) => {
    await page.goto(`/candidates?q=Agus&${qs}`);
    return (await page.getByTestId("candidate-row").filter({ hasText: "Agus Pratama" }).count()) === 1;
  };
  // rata-rata tiga penilaian terbaru = (4.0 + 2.0) / 2 = 3.0; kehadiran = (90 + 70) / 2 = 80
  expect(await listed("avg=3")).toBe(true);
  expect(await listed("avg=3.1")).toBe(false);
  expect(await listed("attendance=80")).toBe(true);
  expect(await listed("attendance=81")).toBe(false);
  expect(await listed("jlpt=N4")).toBe(true);
  expect(await listed("jlpt=N5")).toBe(true);
  expect(await listed("jlpt=N3")).toBe(false);
  expect(await listed("avg=3&attendance=80&jlpt=N4")).toBe(true);
  expect(await listed("avg=3&attendance=80&jlpt=N3")).toBe(false);

  await page.goto("/candidates?q=Agus");
  await expect(page.getByTestId("candidate-row").filter({ hasText: "Agus Pratama" }).getByTestId("latest-avg")).toHaveText("4.0");
  // Kandidat tanpa penilaian tidak lolos filter nilai
  await page.goto("/candidates?avg=1");
  const withAvg = await page.getByTestId("candidate-total").textContent();
  await page.goto("/candidates");
  expect(Number(withAvg)).toBeLessThan(Number(await page.getByTestId("candidate-total").textContent()));

  // Sisi TSK juga punya kolom dan filter
  const tsk = await page.context().browser()!.newContext();
  const p2 = await tsk.newPage();
  await login(p2, "tsk.admin@hashi.test");
  await p2.goto("/candidates");
  await expect(p2.locator("th", { hasText: /Nilai terakhir|最新の評価/ })).toBeVisible();
  const texts = await p2.getByTestId("latest-avg").allTextContents();
  expect(texts.some((t) => /^\d\.\d$/.test(t.trim()))).toBe(true);
  await p2.goto("/candidates?avg=1");
  expect(await p2.getByTestId("candidate-row").count()).toBeGreaterThan(0);
  await expect(p2.locator("#avg")).toBeVisible();
  await tsk.close();
});

test("HTML mentah sensei memuat penilaian tetapi tidak memuat data sensitif", async ({ page }) => {
  await ownerQuery("insert into candidate_private (candidate_id, medical_note) values ($1, $2) on conflict (candidate_id) do update set medical_note = excluded.medical_note", [cid, SECRET_MEDICAL]);
  await login(page, "lpk1.sensei@hashi.test");
  const html = await (await page.request.get(url)).text();
  expect(html).toContain(SECRET_NOTE);
  expect(html).not.toContain(SECRET_MEDICAL);
  for (const s of ["health", "contact", "identity", "family"]) expect(html).not.toContain(`data-testid="section-${s}"`);
});

test("audit penilaian hanya mencatat nama kolom, bukan isi catatan", async () => {
  const rows = await ownerQuery<{ action: string; before: unknown; after: unknown }>(
    "select action, before, after from audit_logs where candidate_id = $1 and action like 'assessment.%' and created_at >= $2",
    [cid, startedAt],
  );
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(rows)).not.toContain(SECRET_NOTE);
});

test("tampilan ponsel: penilaian tampil sebagai kartu", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto(url);
  await expect(page.getByTestId("assessment-card")).toHaveCount(2);
  await expect(page.getByTestId("assessment-table")).toBeHidden();
  await ctx.close();
});
