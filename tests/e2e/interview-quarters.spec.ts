import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// 定期面談 per kuartal + pekerja yang sudah berhenti (T-008). Memakai pekerja ENDED dari seed (satu penempatan ENDED di tengah tahun fiskal).

test.describe.configure({ mode: "serial" });

const run = unique();
let ended = { id: "", name: "", start: "", end: "", fy: 0 };
const fyOf = (iso: string) => (Number(iso.slice(5, 7)) >= 4 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);

test.beforeAll(async () => {
  const [row] = await ownerQuery<{ id: string; name: string; start: string; end: string }>(
    "select c.id::text as id, c.full_name as name, p.start_date::text as start, p.end_date::text as end from placements p join candidates c on c.id = p.candidate_id where p.status = 'ENDED' order by p.end_date desc limit 1",
  );
  expect(row, "seed harus memuat satu pekerja ENDED").toBeTruthy();
  ended = { ...row, fy: fyOf(row.end) };
});

// wawancara yang dibuat tes ke-4 dihapus lewat pemilik DB supaya seed (satu kuartal Belum untuk pekerja berhenti) tetap utuh dan tes bisa diulang
test.afterAll(async () => {
  await ownerQuery("delete from periodic_interviews where candidate_id = $1 and content = $2", [ended.id, `退職前の面談${run}`]);
});

async function staffPage(browser: Browser, email = "tsk.staff@hashi.test", viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await login(page, email);
  return page;
}

test("grid FY pekerja berhenti: baris ENDED dengan penanda 'berhenti', bulan sesudah berhenti tidak ditagih, kuartal pertama Selesai dan kuartal berikutnya Belum; FY sesudahnya tidak memuatnya", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto(`/records/interviews?fy=${ended.fy}`);
  const row = page.locator(`[data-testid=interview-row][data-worker="${ended.id}"]`);
  await expect(row).toHaveAttribute("data-status", "ENDED");
  await expect(row.getByTestId("worker-ended")).toContainText(`berhenti ${ended.end.replace(/-/g, "/")}`);
  const states = await row.locator("[data-testid=quarter-state]").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  expect(states).toContain("done");
  expect(states).toContain("pending");
  // bulan sesudah bulan berhenti: tidak ditagih (—), tanpa tautan
  const endMonth = `${ended.end.slice(0, 7)}-01`;
  const after = await row.locator("[data-testid=interview-cell]").evaluateAll((els, em) => els.filter((e) => e.getAttribute("data-month")! > em).map((e) => [e.getAttribute("data-state"), e.querySelectorAll("a").length]), endMonth);
  expect(after.length).toBeGreaterThan(0);
  for (const [st, links] of after) { expect(st).toBe("notDue"); expect(links).toBe(0); }
  // FY sesudah berhenti: tidak ada
  await page.goto(`/records/interviews?fy=${ended.fy + 1}`);
  await expect(page.locator(`[data-testid=interview-row][data-worker="${ended.id}"]`)).toHaveCount(0);
  await page.context().close();
});

test("daftar laporan tahunan: pekerja berhenti termasuk di FY-nya (jumlah per kuartal + kuartal bolong), tidak di FY sesudahnya; ringkasan sesuai isi tabel", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto(`/records/interviews/annual?fy=${ended.fy}`);
  await expect(page.getByTestId("annual-title")).toContainText(`${ended.fy}/4-${ended.fy + 1}/3`);
  const row = page.locator(`[data-testid=annual-row][data-worker="${ended.id}"]`);
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("annual-ended")).toBeVisible();
  const gaps = (await row.getAttribute("data-gaps"))!;
  expect(gaps.length).toBeGreaterThan(0);
  await expect(row.getByTestId("annual-gaps")).toContainText("Kuartal");
  const done = row.locator("[data-testid=annual-quarter][data-state=done]");
  expect(await done.count()).toBeGreaterThanOrEqual(1);
  expect(Number(await done.first().getAttribute("data-count"))).toBeGreaterThanOrEqual(1);
  // ringkasan = isi tabel
  const rows = await page.getByTestId("annual-row").count();
  const withGaps = await page.locator("[data-testid=annual-row]:not([data-gaps=''])").count();
  const totalGaps = (await page.getByTestId("annual-row").evaluateAll((els) => els.reduce((n, e) => n + ((e.getAttribute("data-gaps") ?? "").split(",").filter(Boolean).length), 0)));
  await expect(page.getByTestId("annual-summary")).toContainText(`${rows} pekerja wajib dilaporkan; ${rows - withGaps} lengkap; ${totalGaps} kuartal bolong`);
  await page.goto(`/records/interviews/annual?fy=${ended.fy + 1}`);
  await expect(page.locator(`[data-testid=annual-row][data-worker="${ended.id}"]`)).toHaveCount(0);
  await page.goto("/records/interviews");
  await expect(page.getByTestId("annual-link")).toBeVisible();
  await page.context().close();
});

test("pemilih pekerja di form ①: pekerja berhenti ikut (di bawah yang aktif, dengan penanda 'berhenti <tanggal>'); catatan susulan dan 'Lanjutkan' untuknya berhasil", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto("/records/new?kind=daily_work");
  const ids = await page.locator("[data-testid^=worker-]:not([data-testid^=worker-ended])").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("worker-", "")));
  expect(ids).toContain(ended.id);
  await expect(page.getByTestId(`worker-ended-${ended.id}`)).toContainText(`berhenti ${ended.end.replace(/-/g, "/")}`);
  const endedIdx = ids.indexOf(ended.id);
  const activeBefore = await page.locator("[data-testid^=worker-]:not([data-testid^=worker-ended])").evaluateAll((els, e) => els.slice(0, e).filter((x) => !x.closest("li")?.querySelector("[data-testid^=worker-ended]")).length, endedIdx);
  expect(activeBefore, "pekerja aktif tampil lebih dulu daripada yang berhenti").toBe(endedIdx);
  // catatan susulan untuk pekerja yang sudah berhenti
  await page.goto(`/records/new?kind=daily_work&worker=${ended.id}`);
  await expect(page.getByTestId(`worker-${ended.id}`)).toBeChecked();
  await page.locator("#workType").selectOption("consultation");
  await page.locator("#actionTaken").fill(`退職後の連絡${run}`);
  await page.getByTestId("save-record").click();
  await page.waitForURL(/\/records\/[0-9a-f-]{36}$/);
  const idA = page.url().split("/").pop()!;
  // "Lanjutkan" untuk pekerja berhenti tetap bisa
  await page.getByTestId("continue-record").click();
  await page.waitForURL(new RegExp(`continue=${idA}`));
  await expect(page.getByTestId(`worker-${ended.id}`)).toBeChecked();
  await expect(page.getByTestId("continue-panel")).toBeVisible();
  await page.context().close();
});

test("wawancara untuk pekerja berhenti: halaman sel terbuka; mengisi kuartal yang bolong menutup bolongnya di daftar tahunan dan KPI turun 1", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto("/");
  const kpiBefore = Number(await page.getByTestId("kpi-interviews-pending-value").textContent());
  const endMonth = `${ended.end.slice(0, 7)}-01`; // bulan berhenti: ada di kuartal terakhir masa kerja (Belum pada seed)
  await page.goto(`/records/interviews/annual?fy=${ended.fy}`);
  const gapBefore = (await page.locator(`[data-testid=annual-row][data-worker="${ended.id}"]`).getAttribute("data-gaps"))!.split(",").filter(Boolean);
  expect(gapBefore.length).toBeGreaterThan(0);
  await page.goto(`/records/interviews/${ended.id}/${endMonth}`);
  await page.locator("#interviewDate").fill(ended.end);
  await page.locator("#resultStatus").selectOption("no_issue");
  await page.locator("#reason").selectOption("agency");
  await page.locator("#content").fill(`退職前の面談${run}`);
  await page.getByTestId("interview-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("interview-state")).toContainText("Tidak ada masalah");
  await page.goto(`/records/interviews/annual?fy=${ended.fy}`);
  const gapAfter = (await page.locator(`[data-testid=annual-row][data-worker="${ended.id}"]`).getAttribute("data-gaps"))!.split(",").filter(Boolean);
  expect(gapAfter.length).toBe(gapBefore.length - 1);
  if (ended.fy === Number((await ownerQuery<{ fy: number }>("select case when extract(month from (now() at time zone 'Asia/Tokyo')) >= 4 then extract(year from (now() at time zone 'Asia/Tokyo'))::int else extract(year from (now() at time zone 'Asia/Tokyo'))::int - 1 end as fy"))[0].fy)) {
    await page.goto("/");
    expect(Number(await page.getByTestId("kpi-interviews-pending-value").textContent())).toBe(kpiBefore - 1);
  }
  await page.context().close();
});

test("LPK_ADMIN dan sensei: daftar laporan tahunan 404; ponsel: daftar tahunan dan grid tanpa scroll horizontal di halaman", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test"]) {
    const page = await staffPage(browser, email);
    expect((await page.goto(`/records/interviews/annual?fy=${ended.fy}`))?.status(), email).toBe(404);
    await page.context().close();
  }
  const page = await staffPage(browser, "tsk.staff@hashi.test", { width: 390, height: 844 });
  for (const path of [`/records/interviews/annual?fy=${ended.fy}`, `/records/interviews?fy=${ended.fy}`]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  await page.context().close();
});
