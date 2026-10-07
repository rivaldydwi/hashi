import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// "Lanjutkan catatan" dan riwayat per pekerja (T-007). Memakai pekerja aktif dari seed; semua catatan uji bertanda unik.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date().toISOString();
const MARK_A = `続き元${run}`;
const MARK_B = `続き先${run}`;
const TASK = `次回の確認事項${run}`;
const UUID_URL = /\/records\/[0-9a-f-]{36}$/;
let worker = { id: "", name: "" };
let idA = "";
let idB = "";
let caseId = "";

test.beforeAll(async () => {
  [worker] = await ownerQuery<{ id: string; name: string }>("select c.id::text as id, c.full_name as name from placements p join candidates c on c.id = p.candidate_id where p.status = 'ACTIVE' order by c.full_name desc limit 1");
});

async function ctxPage(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await login(page, email);
  return page;
}

test("catatan asal A (dengan kasus dan tindak lanjut terbuka) dibuat staf TSK", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/new?kind=daily_work&worker=${worker.id}`);
  await page.locator("#workType").selectOption("consultation");
  await page.locator("#actionTaken").fill(MARK_A);
  await page.getByTestId("save-record").click();
  await page.waitForURL(UUID_URL);
  idA = page.url().split("/").pop()!;
  // kasus (kode diberi trigger) + tindak lanjut terbuka, lewat pemilik basis data
  const [org] = await ownerQuery<{ id: string }>("select organization_id::text as id from activity_records where id = $1", [idA]);
  const [admin] = await ownerQuery<{ id: string }>("select id::text as id from users where email = 'tsk.admin@hashi.test'");
  const [kase] = await ownerQuery<{ id: string }>("insert into activity_cases (organization_id, created_by, code, title, category) values ($1, $2, '', $3, 'life_consultation') returning id::text as id", [org.id, admin.id, `案件${run}`]);
  caseId = kase.id;
  await ownerQuery("insert into activity_case_subjects (case_id, candidate_id, organization_id) values ($1, $2, $3)", [caseId, worker.id, org.id]);
  await ownerQuery("update activity_records set case_id = $1 where id = $2", [caseId, idA]);
  await ownerQuery("insert into activity_followups (organization_id, created_by, record_id, description, assignee_id) values ($1, $2, $3, $4, $2)", [org.id, admin.id, idA, TASK]);
  await page.context().close();
});

test("'Lanjutkan': form terisi pekerja/lokasi/kasus (ditandai otomatis) + ringkasan catatan terakhir dan tindak lanjut terbuka; simpan -> saling menunjuk", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.admin@hashi.test");
  await page.goto(`/records/${idA}`);
  await expect(page.getByTestId("worker-history-link").first()).toBeVisible();
  await page.getByTestId("continue-record").click();
  await page.waitForURL(new RegExp(`/records/new\\?kind=daily_work&continue=${idA}`));
  await expect(page.getByTestId(`worker-${worker.id}`)).toBeChecked();
  for (const k of ["subjects", "site", "case"]) await expect(page.getByTestId(`autofilled-${k}`)).toBeVisible();
  await expect(page.locator("#caseId")).toHaveValue(caseId);
  const panel = page.getByTestId("continue-panel");
  await expect(panel).toBeVisible();
  const recent = panel.getByTestId("continue-recent-item");
  expect(await recent.count()).toBeLessThanOrEqual(3);
  await expect(panel.getByTestId("continue-recent")).toContainText(MARK_A);
  await expect(panel.getByTestId("continue-tasks")).toContainText(TASK);
  // T-023: isi tindak lanjut boleh diterjemahkan, tetapi nama staf penanggungnya dikunci translate=no
  const taskItem = panel.getByTestId("continue-task").filter({ hasText: TASK }).first();
  const assignee = taskItem.locator('[translate="no"]');
  await expect(assignee).toHaveCount(1);
  expect(((await assignee.textContent()) ?? "").trim().length, "nama staf terisi").toBeGreaterThan(0);
  expect(await taskItem.evaluate((e) => !!e.closest('[translate="no"]')), "kalimat tindak lanjut tidak dikunci").toBe(false);
  await page.locator("#workType").selectOption("interview");
  await page.locator("#actionTaken").fill(MARK_B);
  await page.getByTestId("save-record").click();
  await page.waitForURL(UUID_URL);
  idB = page.url().split("/").pop()!;
  expect(idB).not.toBe(idA);
  await expect(page.getByTestId("continued-from")).toContainText(MARK_A);
  await expect(page.getByTestId("continued-from").locator("a")).toHaveAttribute("href", `/records/${idA}`);
  await page.goto(`/records/${idA}`);
  await expect(page.getByTestId("continued-by")).toHaveCount(1);
  await expect(page.getByTestId("continued-by")).toContainText(MARK_B);
  const [row] = await ownerQuery<{ continues: string; same: boolean; site: boolean; kase: boolean }>(
    `select b.continues_record_id::text as continues,
            exists (select 1 from activity_record_subjects s where s.record_id = b.id and s.candidate_id = $3) as same,
            (b.client_site_id is not distinct from a.client_site_id) as site, (b.case_id = a.case_id) as kase
       from activity_records b join activity_records a on a.id = $1 where b.id = $2`, [idA, idB, worker.id]);
  expect(row).toMatchObject({ continues: idA, same: true, site: true, kase: true });
  await page.context().close();
});

test("riwayat pekerja: kedua catatan, tindak lanjut terbuka, label 'Lanjutan', urutan bisa dibalik, tautan dari detail kandidat dan grid wawancara", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/workers/${worker.id}`);
  await expect(page.getByTestId("worker-history-title")).toContainText(worker.name);
  await expect(page.getByTestId("worker-open-tasks")).toContainText(TASK);
  const items = page.getByTestId("timeline-item");
  const ids = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  expect(ids).toContain(idA);
  expect(ids).toContain(idB);
  expect(ids.indexOf(idB!)).toBeLessThan(ids.indexOf(idA!)); // terbaru di atas
  await expect(page.locator(`[data-testid=timeline-item][data-id="${idB}"] [data-testid=badge-continued]`)).toBeVisible();
  await expect(page.locator(`[data-testid=timeline-item][data-id="${idA}"] [data-testid=badge-continued]`)).toHaveCount(0);
  await page.getByTestId("order-asc").click();
  await expect(page.getByTestId("worker-timeline")).toHaveAttribute("data-order", "asc");
  const asc = await page.getByTestId("timeline-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  expect(asc.indexOf(idA!)).toBeLessThan(asc.indexOf(idB!));
  // memuat unsur ③ dan ④ untuk pekerja yang punya (seed): jenis tampil sebagai label
  const kinds = new Set(await page.getByTestId("timeline-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-item"))));
  expect(kinds.has("record")).toBe(true);
  // tautan masuk
  await page.goto(`/candidates/${worker.id}`);
  await expect(page.getByTestId("worker-history-open")).toBeVisible();
  await page.goto("/records/interviews");
  await expect(page.getByTestId("interview-worker-history").first()).toBeVisible();
  await page.context().close();
});

test("catatan dari kasus: baris kronologi (③) dan wawancara (④) pekerja ikut dalam satu garis waktu; yang dibatalkan dicoret", async ({ browser }) => {
  const [org] = await ownerQuery<{ id: string }>("select organization_id::text as id from activity_records where id = $1", [idA]);
  const [admin] = await ownerQuery<{ id: string }>("select id::text as id from users where email = 'tsk.admin@hashi.test'");
  await ownerQuery("insert into case_timeline_events (organization_id, created_by, case_id, occurred_at, event) values ($1, $2, $3, now(), $4)", [org.id, admin.id, caseId, `出来事${run}`]);
  const [ev] = await ownerQuery<{ id: string }>("insert into case_timeline_events (organization_id, created_by, case_id, occurred_at, event, status, void_reason) values ($1, $2, $3, now(), $4, 'void', 'uji') returning id::text as id", [org.id, admin.id, caseId, `誤記${run}`]);
  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/workers/${worker.id}`);
  await expect(page.locator(`[data-testid=timeline-item][data-item=event]`, { hasText: `出来事${run}` })).toHaveCount(1);
  const voided = page.locator(`[data-testid=timeline-item][data-id="${ev.id}"]`);
  await expect(voided).toHaveAttribute("data-status", "void");
  await expect(voided.locator("p.line-through")).toHaveCount(1);
  const interviewItems = await page.locator("[data-testid=timeline-item][data-item=interview]").count();
  const [seedIv] = await ownerQuery<{ n: number }>("select count(*)::int as n from periodic_interviews where candidate_id = $1 and (applicable or interview_date is not null or content is not null)", [worker.id]);
  expect(interviewItems).toBe(Math.min(seedIv.n, 30));
  await page.context().close();
});

test("paginasi: riwayat panjang dibagi per 30 entri; ponsel tanpa scroll horizontal", async ({ browser }) => {
  const [org] = await ownerQuery<{ id: string }>("select organization_id::text as id from activity_records where id = $1", [idA]);
  const [admin] = await ownerQuery<{ id: string }>("select id::text as id from users where email = 'tsk.admin@hashi.test'");
  const made = await ownerQuery<{ id: string }>(
    `insert into activity_records (organization_id, created_by, author_id, kind, record_date, work_type, action_taken)
     select $1::uuid, $2::uuid, $2::uuid, 'daily_work', current_date - (g % 20), 'consultation', $3 || g from generate_series(1, 32) g returning id::text as id`, [org.id, admin.id, `ページ${run}-`]);
  await ownerQuery("insert into activity_record_subjects (record_id, candidate_id, organization_id) select unnest($1::uuid[]), $2::uuid, $3::uuid", [made.map((m) => m.id), worker.id, org.id]);
  const page = await ctxPage(browser, "tsk.staff@hashi.test", { width: 390, height: 844 });
  await page.goto(`/records/workers/${worker.id}`);
  expect(await page.getByTestId("timeline-item").count()).toBe(30);
  await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();
  const total = Number((await page.getByTestId("worker-total").textContent())!.replace(/\D/g, ""));
  expect(total).toBeGreaterThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto(`/records/workers/${worker.id}?page=2`);
  expect(await page.getByTestId("timeline-item").count()).toBe(total - 30 > 30 ? 30 : total - 30);
  await page.goto(`/records/new?kind=daily_work&continue=${idA}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); // form lanjutan + panel di ponsel
  await page.context().close();
});

test("LPK_ADMIN dan sensei: riwayat pekerja dan 'Lanjutkan' 404; catatan asal yang dibatalkan tidak bisa dilanjutkan", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test"]) {
    const page = await ctxPage(browser, email);
    expect((await page.goto(`/records/workers/${worker.id}`))?.status(), email).toBe(404);
    expect((await page.goto(`/records/new?kind=daily_work&continue=${idA}`))?.status(), email).toBe(404);
    expect((await page.goto(`/records/${idA}`))?.status(), email).toBe(404);
    await page.context().close();
  }
  const page = await ctxPage(browser, "tsk.admin@hashi.test");
  expect((await page.goto(`/records/workers/not-a-uuid`))?.status()).toBe(404);
  expect((await page.goto(`/records/new?kind=daily_work&continue=not-a-uuid`))?.status()).toBe(404);
  // batalkan B (lewat pemilik DB: void final) -> menunjuk "dibatalkan"; lalu A tetap bisa dilanjutkan, B tidak
  await ownerQuery("update activity_records set status = 'void', void_reason = 'uji' where id = $1", [idB]);
  expect((await page.goto(`/records/new?kind=daily_work&continue=${idB}`))?.status()).toBe(404);
  await page.goto(`/records/${idB}`);
  await expect(page.getByTestId("continue-record")).toHaveCount(0);
  await page.goto(`/records/${idA}`);
  await expect(page.getByTestId("continued-by")).toContainText(MARK_B); // rantai tetap terlihat; yang dibatalkan ditandai
  await expect(page.getByTestId("continued-by").getByText(/Dibatalkan|取消済み/)).toBeVisible();
  await page.context().close();
});

test("audit: pembuatan lanjutan mencatat continued=true tanpa isi catatan; server menolak asal tak sah (pekerja beda)", async ({ browser }) => {
  const [a] = await ownerQuery<{ after: Record<string, unknown> }>("select after from audit_logs where action = 'activity_record.create' and entity_id = $1 and created_at >= $2", [idB, startedAt]);
  expect(a.after.continued).toBe(true);
  expect(JSON.stringify(a.after)).not.toContain(MARK_B);
  // POST langsung dengan asal valid tetapi pekerja berbeda: ditolak aplikasi (pesan), tidak ada catatan baru
  const [other] = await ownerQuery<{ id: string }>("select c.id::text as id from placements p join candidates c on c.id = p.candidate_id where p.status = 'ACTIVE' and c.id <> $1 limit 1", [worker.id]);
  const before = (await ownerQuery<{ n: number }>("select count(*)::int as n from activity_records"))[0].n;
  const page = await ctxPage(browser, "tsk.admin@hashi.test");
  await page.goto(`/records/new?kind=daily_work&worker=${other.id}`);
  await page.evaluate((cont) => {
    const f = document.querySelector("form[data-testid=record-form-daily_work]")!;
    const i = document.createElement("input"); i.type = "hidden"; i.name = "continuesRecordId"; i.value = cont; f.appendChild(i);
  }, idA);
  await page.locator("#workType").selectOption("consultation");
  await page.locator("#actionTaken").fill(`拒否${run}`);
  await page.getByTestId("save-record").click();
  await expect(page.getByText(/setidaknya satu pekerja yang sama|同じ就労者/)).toBeVisible();
  expect((await ownerQuery<{ n: number }>("select count(*)::int as n from activity_records"))[0].n).toBe(before);
  await page.context().close();
});
