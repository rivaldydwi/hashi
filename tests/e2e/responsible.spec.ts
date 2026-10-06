import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Penanggung jawab pekerja + beban kerja (T-010). Semua perubahan lewat UI/DB uji dibersihkan di afterAll (riwayat penetapan dihapus lewat pemilik DB; tes bisa diulang).

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date().toISOString();
let staff2Id = "";
let scratchCompany = "";
let scratchSite = "";
let scratchCompany2 = "";
const scratchCandidates: string[] = [];

test.beforeAll(async () => {
  [{ id: staff2Id }] = await ownerQuery<{ id: string }>("select id::text as id from users where email = 'tsk.staff2@hashi.test'");
});

test.afterAll(async () => {
  if (scratchCandidates.length) await ownerQuery("delete from candidates where id = any($1::uuid[])", [scratchCandidates]); // placements ikut terhapus (cascade)
  if (scratchCompany2) await ownerQuery("delete from client_companies where id = $1", [scratchCompany2]);
  if (scratchCompany) await ownerQuery("delete from client_companies where id = $1", [scratchCompany]); // lokasi + penetapan perusahaan ikut terhapus (cascade)
  await ownerQuery("delete from responsible_assignments where created_at >= $1", [startedAt]);
});

async function ctxPage(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await login(page, email);
  return page;
}
const counts = async (page: Page) => Object.fromEntries(await page.getByTestId("workload-row").evaluateAll((els) => els.map((e) => [e.getAttribute("data-staff"), Number(e.getAttribute("data-count"))])));
const staffCount = async (page: Page, id: string) => Number(await page.locator(`[data-testid=workload-row][data-staff="${id}"]`).getAttribute("data-count"));

test("tetapkan per pekerja lalu kembalikan ke perusahaan: angka beban berpindah dan kembali; riwayat tercatat; audit hanya id/cakupan", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.admin@hashi.test"); // UI berbahasa Jepang: pakai data-testid
  await page.goto("/records/responsible");
  const before = await counts(page);
  // pekerja AKTIF yang mewarisi dari perusahaan (source=company) dan staf tujuan yang berbeda
  const row = page.locator("[data-testid=worker-row][data-status=ACTIVE][data-source=company]").first();
  await expect(row).toBeVisible();
  const workerId = (await row.getAttribute("data-worker"))!;
  const from = (await row.getAttribute("data-responsible"))!;
  const target = Object.keys(before).find((s) => s !== from)!;
  await row.getByTestId("worker-form").locator("select[name=staffId]").selectOption(target);
  await row.getByTestId("worker-form").locator("button[type=submit]").click();
  await expect(page.locator(`[data-testid=worker-row][data-worker="${workerId}"]`)).toHaveAttribute("data-responsible", target);
  await expect(page.locator(`[data-testid=worker-row][data-worker="${workerId}"]`)).toHaveAttribute("data-source", "placement");
  const during = await counts(page);
  expect(during[target]).toBe(before[target] + 1);
  expect(during[from]).toBe(before[from] - 1);
  // kembali ke perusahaan ("ikut perusahaan" = nilai kosong): beban kembali seperti semula
  const row2 = page.locator(`[data-testid=worker-row][data-worker="${workerId}"]`);
  await row2.getByTestId("worker-form").locator("select[name=staffId]").selectOption("");
  await row2.getByTestId("worker-form").locator("button[type=submit]").click();
  await expect(page.locator(`[data-testid=worker-row][data-worker="${workerId}"]`)).toHaveAttribute("data-source", "company");
  expect(await counts(page)).toEqual(before);
  await expect(page.getByTestId("history-item").first()).toBeVisible();
  expect(await page.locator("[data-testid=history-item][data-scope=placement]").count()).toBeGreaterThanOrEqual(2);
  // audit: id + cakupan saja, tanpa nama staf/pekerja
  const rows = await ownerQuery<{ before: unknown; after: Record<string, unknown>; entity_id: string }>("select before, after, entity_id from audit_logs where action = 'responsible.set' and created_at >= $1", [startedAt]);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  const names = await ownerQuery<{ name: string; email: string }>("select name, email from users where organization_id = (select organization_id from users where email = 'tsk.admin@hashi.test')");
  const dump = JSON.stringify(rows);
  for (const n of names) { expect(dump).not.toContain(n.name); expect(dump).not.toContain(n.email); }
  for (const r of rows) expect(Object.keys(r.after)).toEqual(["scope"]);
  await page.context().close();
});

test("tetapkan per perusahaan: pekerja yang mewarisi pindah ke staf baru, yang punya penanggung jawab khusus tidak berubah", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.admin@hashi.test");
  await page.goto("/records/responsible");
  const before = await counts(page);
  // perusahaan dengan >= 1 pekerja aktif yang mewarisi
  const inherit = page.locator("[data-testid=worker-row][data-status=ACTIVE][data-source=company]");
  const company = await inherit.first().getAttribute("data-company");
  expect(company, "worker-row memuat data-company").toBeTruthy();
  const movers = await page.locator(`[data-testid=worker-row][data-status=ACTIVE][data-source=company][data-company="${company}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-responsible")));
  const target = Object.keys(before).find((s) => !movers.includes(s))!;
  const form = page.locator(`[data-testid=company-row][data-company="${company}"]`).getByTestId("company-form");
  await form.locator("select[name=staffId]").selectOption(target);
  await form.locator("button[type=submit]").click();
  await expect.poll(async () => staffCount(page, target)).toBe(before[target] + movers.length);
  const after = await counts(page);
  const expected = { ...before };
  expected[target] += movers.length;
  for (const m of movers) expected[m!] -= 1;
  expect(after).toEqual(expected);
  await page.context().close();
});

test("batas 50 per staf: 45 = kuning, 50 = kuning (batas tercapai), 51 = merah + KPI dashboard Admin TSK; simpan TIDAK diblokir; yang sudah berhenti tidak dihitung", async ({ browser }) => {
  // data uji: perusahaan + lokasi + N pekerja aktif (kandidat uji dari LPK mitra, dibagikan) yang penanggung jawabnya staf2 (penetapan per perusahaan)
  const [org] = await ownerQuery<{ id: string }>("select id::text as id from organizations where name = 'TSK Demo Tokyo'");
  const [admin] = await ownerQuery<{ id: string }>("select id::text as id from users where email = 'tsk.admin@hashi.test'");
  [{ id: scratchCompany }] = await ownerQuery<{ id: string }>("insert into client_companies (org_id, name) values ($1, $2) returning id::text as id", [org.id, `株式会社担当${run}`]);
  [{ id: scratchSite }] = await ownerQuery<{ id: string }>("insert into client_sites (org_id, company_id, name) values ($1, $2, $3) returning id::text as id", [org.id, scratchCompany, `担当事業所${run}`]);
  await ownerQuery("insert into responsible_assignments (organization_id, created_by, company_id, staff_id, effective_from) values ($1, $2, $3, $4, current_date - 1)", [org.id, admin.id, scratchCompany, staff2Id]);
  const addWorkers = async (n: number, ended = false) => {
    const rows = await ownerQuery<{ id: string }>(
      `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
       select o.id, $2 || g, 'MALE', '2000-05-15', (select id from skill_fields where code = 'food'), 'READY', true from organizations o, generate_series(1, $1) g where o.name = 'LPK Demo Bandung' returning id::text as id`, [n, `Uji Beban ${run} `]);
    scratchCandidates.push(...rows.map((r) => r.id));
    await ownerQuery(
      `insert into placements (candidate_id, org_id, site_id, start_date, end_date, status) select unnest($1::uuid[]), $2::uuid, $3::uuid, current_date - 60, ${ended ? "current_date - 5" : "null"}, $4`,
      [rows.map((r) => r.id), org.id, scratchSite, ended ? "ENDED" : "ACTIVE"]);
  };
  const staff = await ctxPage(browser, "tsk.staff@hashi.test"); // UI Indonesia
  await staff.goto("/records/responsible");
  const base = await staffCount(staff, staff2Id);
  await addWorkers(45 - base);
  await addWorkers(7, true); // pekerja yang sudah berhenti tidak dihitung
  await staff.reload();
  expect(await staffCount(staff, staff2Id)).toBe(45);
  let r = staff.locator(`[data-testid=workload-row][data-staff="${staff2Id}"]`);
  await expect(r).toHaveAttribute("data-level", "warn");
  await expect(staff.locator("[data-testid=workload-warning][data-level=warn]")).toContainText("memegang 45 pekerja");
  await expect(staff.getByTestId("workload-rule")).toContainText("50 pekerja");
  await expect(staff.getByTestId("workload-rule")).toContainText("2027/04/01");
  await addWorkers(5); // 50: batas tercapai, belum melebihi
  await staff.reload();
  expect(await staffCount(staff, staff2Id)).toBe(50);
  await expect(staff.locator(`[data-testid=workload-row][data-staff="${staff2Id}"]`)).toHaveAttribute("data-level", "warn");
  await addWorkers(1); // 51: merah
  await staff.reload();
  r = staff.locator(`[data-testid=workload-row][data-staff="${staff2Id}"]`);
  await expect(r).toHaveAttribute("data-level", "over");
  await expect(r.getByTestId("workload-level")).toContainText("Melebihi batas");
  await expect(staff.locator("[data-testid=workload-warning][data-level=over]")).toContainText("melebihi batas 50");
  // KPI Admin TSK = jumlah staf melebihi batas = daftar ?view=over; TSK_STAFF tidak punya KPI ini
  const admin2 = await ctxPage(browser, "tsk.admin@hashi.test");
  await admin2.goto("/");
  const kpi = Number(await admin2.getByTestId("kpi-staff-over-value").textContent());
  expect(kpi).toBeGreaterThanOrEqual(1);
  await admin2.getByTestId("kpi-staff-over").click();
  await expect(admin2).toHaveURL(/\/records\/responsible\?view=over/);
  expect(await admin2.getByTestId("workload-row").count()).toBe(kpi);
  await staff.goto("/");
  await expect(staff.getByTestId("kpi-staff-over")).toHaveCount(0);
  await expect(staff.getByTestId("kpi-unassigned")).toHaveCount(0);
  // TIDAK diblokir: admin tetap bisa menyimpan penanggung jawab khusus ke staf yang sudah melebihi batas (52). Pekerja uji di perusahaan lain TANPA penanggung jawab.
  [{ id: scratchCompany2 }] = await ownerQuery<{ id: string }>("insert into client_companies (org_id, name) values ($1, $2) returning id::text as id", [org.id, `株式会社別${run}`]);
  const [site2] = await ownerQuery<{ id: string }>("insert into client_sites (org_id, company_id, name) values ($1, $2, $3) returning id::text as id", [org.id, scratchCompany2, `別事業所${run}`]);
  const [mv] = await ownerQuery<{ id: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
     select o.id, $1, 'MALE', '2000-05-15', (select id from skill_fields where code = 'food'), 'READY', true from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id`, [`Uji Pindah ${run}`]);
  scratchCandidates.push(mv.id);
  await ownerQuery("insert into placements (candidate_id, org_id, site_id, start_date, status) values ($1, $2, $3, current_date - 30, 'ACTIVE')", [mv.id, org.id, site2.id]);
  await admin2.goto("/records/responsible");
  const mover = admin2.locator(`[data-testid=worker-row][data-worker="${mv.id}"]`);
  await expect(mover).toHaveAttribute("data-source", "none");
  const form = mover.getByTestId("worker-form");
  await form.locator("select[name=staffId]").selectOption(staff2Id);
  await form.locator("button[type=submit]").click();
  await expect(admin2.locator(`[data-testid=worker-row][data-worker="${mv.id}"]`)).toHaveAttribute("data-responsible", staff2Id);
  await expect(admin2.locator("[data-testid=form-error]")).toHaveCount(0);
  expect(await staffCount(admin2, staff2Id)).toBe(52);
  await staff.context().close();
  await admin2.context().close();
});

test("daftar 'belum ada penanggung jawab' = KPI; staf (non-admin) melihat tetapi tanpa formulir ubah; 'pekerja saya' menyaring; tampil di detail kandidat, grid wawancara, dan riwayat pekerja", async ({ browser }) => {
  const admin = await ctxPage(browser, "tsk.admin@hashi.test");
  await admin.goto("/");
  const kpi = Number(await admin.getByTestId("kpi-unassigned-value").textContent());
  await admin.getByTestId("kpi-unassigned").click();
  await expect(admin).toHaveURL(/\/records\/responsible\?view=unassigned/);
  expect(Number(((await admin.getByTestId("unassigned-count").textContent()) ?? "").replace(/\D/g, ""))).toBe(kpi);
  expect(await admin.getByTestId("unassigned-item").count()).toBe(kpi);
  expect(kpi).toBeGreaterThan(0);
  await admin.context().close();

  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  await page.goto("/records/responsible");
  await expect(page.getByTestId("worker-form")).toHaveCount(0);
  await expect(page.getByTestId("company-form")).toHaveCount(0);
  const me = (await ownerQuery<{ id: string }>("select id::text as id from users where email = 'tsk.staff@hashi.test'"))[0].id;
  await page.goto("/records/responsible?mine=1");
  const rows = await page.getByTestId("worker-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-responsible")));
  for (const x of rows) expect(x).toBe(me);
  // tampil di grid wawancara (kolom + filter pekerja saya), riwayat pekerja, dan detail kandidat
  await page.goto("/records/interviews?mine=1");
  const gridStaff = await page.getByTestId("grid-responsible").evaluateAll((els) => els.map((e) => e.getAttribute("data-staff")));
  for (const x of gridStaff) expect(x).toBe(me);
  await page.goto("/records/interviews");
  const first = page.locator("[data-testid=interview-row][data-status=ACTIVE]").first();
  const wid = (await first.getAttribute("data-worker"))!;
  await expect(first.getByTestId("grid-responsible")).toBeVisible();
  await page.goto(`/records/workers/${wid}`);
  await expect(page.getByTestId("worker-responsible")).toBeVisible();
  await page.goto(`/candidates/${wid}`);
  await expect(page.getByTestId("worker-responsible")).toBeVisible();
  await page.context().close();
});

test("LPK_ADMIN dan sensei: halaman penanggung jawab 404; ponsel: halaman tanpa scroll horizontal", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test"]) {
    const page = await ctxPage(browser, email);
    expect((await page.goto("/records/responsible"))?.status(), email).toBe(404);
    await page.context().close();
  }
  const page = await ctxPage(browser, "tsk.staff@hashi.test", { width: 390, height: 844 });
  await page.goto("/records/responsible");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.context().close();
});
