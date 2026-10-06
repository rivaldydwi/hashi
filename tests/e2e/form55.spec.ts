import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Form 参考様式第5-5号 per wawancara berkala + halaman tahunan per pekerja (T-009). Wawancara uji ada di bulan 2020-05 (tahun fiskal 2020) supaya seed tidak tersentuh;
// dihapus lewat pemilik DB di afterAll (riwayat revisi append-only tetap, tidak memuat data kandidat).

test.describe.configure({ mode: "serial" });

const run = unique();
const MONTH = "2020-05-01";
const startedAt = new Date().toISOString();
let worker = { id: "", name: "" };
let responsible: { workerId: string; staffId: string } | null = null;

test.beforeAll(async () => {
  [worker] = await ownerQuery<{ id: string; name: string }>("select c.id::text as id, c.full_name as name from placements p join candidates c on c.id = p.candidate_id where p.status = 'ACTIVE' order by c.full_name limit 1");
  expect(worker?.id, "seed harus memuat pekerja aktif").toBeTruthy();
  const [r] = await ownerQuery<{ workerId: string; staffId: string }>(
    `select distinct on (p.candidate_id) p.candidate_id::text as "workerId", ra.staff_id::text as "staffId" from responsible_assignments ra join placements p on p.id = ra.placement_id
      where ra.staff_id is not null and p.status = 'ACTIVE' order by p.candidate_id, ra.effective_from desc, ra.created_at desc limit 1`,
  );
  responsible = r ?? null;
});

test.afterAll(async () => {
  await ownerQuery("delete from periodic_interviews where period_month = $1 and candidate_id = $2", [MONTH, worker.id]);
});

async function staffPage(browser: Browser, email = "tsk.staff@hashi.test", viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await login(page, email);
  return page;
}
const row = async () => (await ownerQuery<{ form55: any; method: string | null; responder_role: string | null; responder_title: string | null; version_no: number; staff_id: string | null }>(
  "select form55, method, responder_role, responder_title, version_no, staff_id::text from periodic_interviews where candidate_id = $1 and period_month = $2 and status = 'active'", [worker.id, MONTH]))[0];
const save = (page: Page) => page.getByTestId("interview-form").locator("button[type=submit]").click();

test("isi form 5-5 lengkap (butir ada masalah + 基準不適合 + penanganan): tersimpan terstruktur; bagian 4 hanya muncul bila ⑥ = 有; butir bermasalah wajib isi", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto(`/records/interviews/${worker.id}/${MONTH}`);
  await expect(page.getByTestId("form55-section")).toBeVisible();
  await expect(page.getByTestId("f55-response")).toHaveCount(0); // ⑥ belum 有
  await page.locator("#interviewDate").fill("2020-05-20");
  await page.locator("#resultStatus").selectOption("issue");
  await page.locator("#reason").selectOption("agency");
  await page.locator("#content").fill(`面談内容${run}`);
  await page.getByTestId("method-online").check();
  await page.getByTestId("responder-role").selectOption("support_manager");
  await page.getByTestId("responder-title").fill("課長");
  await page.getByTestId("work.1-ok").check();
  await page.getByTestId("treatment.3-problem").check();
  await expect(page.getByTestId("treatment.3-text")).toHaveAttribute("required", ""); // butir bermasalah wajib berisi
  await page.getByTestId("treatment.3-text").fill(`有給の申請が難しい${run}`);
  await page.getByTestId("life.2-ok").check();
  await page.getByTestId("nc-yes").check();
  await expect(page.getByTestId("f55-response")).toBeVisible();
  await page.getByTestId("r-occurredOn").fill("2020-05-10");
  await page.getByTestId("r-content").fill(`申出あり${run}`);
  await page.getByTestId("r-worker-referred").check();
  await page.locator("#f55-wb").fill("労働基準監督署");
  await page.getByTestId("f55.r.company.notified-done").check();
  await page.locator("#f55-no").fill("2020-05-12");
  await page.locator("#f55-nt").fill("工場長");
  await page.getByTestId("f55.r.company.immigration-not_done").check();
  await page.getByTestId("f55.r.agency.reported-not_done").check();
  await page.locator("#f55-rr").fill("不要と判断");
  await page.locator("#f55-special").fill(`特筆${run}`);
  await page.getByTestId("f55-createdOn").fill("2020-05-21");
  await save(page);
  await expect.poll(async () => (await row())?.form55?.nonconformity, { timeout: 15000 }).toBe(true);
  const r = await row();
  expect(r.method).toBe("online");
  expect(r.responder_role).toBe("support_manager");
  expect(r.responder_title).toBe("課長");
  expect(r.form55.items["work.1"]).toEqual({ a: "ok", text: "" });
  expect(r.form55.items["treatment.3"].a).toBe("problem");
  expect(r.form55.items["treatment.3"].text).toBe(`有給の申請が難しい${run}`);
  expect(r.form55.items["work.2"]).toBeUndefined(); // belum dijawab tidak disimpan
  expect(r.form55.response.occurredOn).toBe("2020-05-10");
  expect(r.form55.response.worker).toEqual({ kind: "referred", body: "労働基準監督署", reason: "" });
  expect(r.form55.response.company.notified).toBe("done");
  expect(r.form55.response.agency.reason).toBe("不要と判断");
  expect(r.form55.createdOn).toBe("2020-05-21");
  // dimuat ulang: semua isian kembali
  await page.reload();
  await expect(page.getByTestId("method-online")).toBeChecked();
  await expect(page.getByTestId("treatment.3-problem")).toBeChecked();
  await expect(page.getByTestId("treatment.3-text")).toHaveValue(`有給の申請が難しい${run}`);
  await expect(page.getByTestId("nc-yes")).toBeChecked();
  await expect(page.getByTestId("r-content")).toHaveValue(`申出あり${run}`);
  await expect(page.getByTestId("form55-state")).toContainText("ketidaksesuaian");
  await page.context().close();
});

test("edit: ⑥ jadi なし membuang bagian 4; versi naik; riwayat menampilkan perubahan Form 5-5; audit TANPA isi (hanya form55=filled dan nonconformity)", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto(`/records/interviews/${worker.id}/${MONTH}`);
  await page.getByTestId("nc-no").check();
  await expect(page.getByTestId("f55-response")).toHaveCount(0);
  await save(page);
  await expect.poll(async () => (await row())?.form55?.nonconformity, { timeout: 15000 }).toBe(false);
  const r = await row();
  expect(r.form55.response).toBeNull();
  expect(r.version_no).toBe(2);
  await page.reload();
  await expect(page.getByTestId("interview-history")).toContainText("Form 5-5");
  const audit = await ownerQuery<{ action: string; after: any }>("select action, after from audit_logs where entity = 'periodic_interview' and created_at >= $1 order by id", [startedAt]);
  expect(audit.map((a) => a.action)).toEqual(["periodic_interview.create", "periodic_interview.update"]);
  expect(audit[0].after.nonconformity).toBe("yes");
  expect(audit[1].after.nonconformity).toBe("no");
  expect(audit.every((a) => a.after.form55 === "filled")).toBe(true);
  expect(JSON.stringify(audit)).not.toContain(run); // tidak ada isi teks di audit
  await page.context().close();
});

test("'Belum dilaksanakan' tidak menyimpan isi form 5-5 (data lama/kosong tetap sah)", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto(`/records/interviews/${worker.id}/${MONTH}`);
  await page.locator("#resultStatus").selectOption("not_done");
  await save(page);
  await expect.poll(async () => (await row())?.form55, { timeout: 15000 }).toBeNull();
  const r = await row();
  expect(r.method).toBeNull();
  expect(r.responder_role).toBeNull();
  await expect(page.getByTestId("form55-pdf")).toHaveCount(0); // belum dilaksanakan: tanpa tombol PDF
  // kembalikan: dilaksanakan lagi dengan form isi sebagian
  await page.locator("#resultStatus").selectOption("no_issue");
  await page.locator("#reason").selectOption("support");
  await page.locator("#interviewDate").fill("2020-05-20");
  await page.getByTestId("work.1-ok").check();
  await page.getByTestId("nc-no").check();
  await save(page);
  await expect.poll(async () => (await row())?.form55?.items?.["work.1"]?.a, { timeout: 15000 }).toBe("ok");
  await page.context().close();
});

test("PDF per wawancara dan PDF gabungan setahun: berkas PDF sah, tercatat di audit tanpa isi", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto(`/records/interviews/${worker.id}/${MONTH}`);
  await expect(page.getByTestId("form55-pdf")).toHaveAttribute("href", `/records/export/form55/${worker.id}/${MONTH}`);
  const one = await page.request.get(`/records/export/form55/${worker.id}/${MONTH}`);
  expect(one.status()).toBe(200);
  expect(one.headers()["content-type"]).toBe("application/pdf");
  expect(one.headers()["content-disposition"]).toContain("attachment");
  expect((await one.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const all = await page.request.get(`/records/export/form55-year/${worker.id}?fy=2020`);
  expect(all.status()).toBe(200);
  expect((await all.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await page.request.get(`/records/export/form55/${worker.id}/2020-05-15`)).status()).toBe(404); // bukan tanggal 1
  expect((await page.request.get(`/records/export/form55/${worker.id}/2020-07-01`)).status()).toBe(404); // tidak ada wawancara
  const ex = await ownerQuery<{ after: any }>("select after from audit_logs where action = 'activity_export' and created_at >= $1 order by id", [startedAt]);
  expect(ex.map((e) => e.after.exportKind)).toEqual(expect.arrayContaining(["form55", "form55_year"]));
  expect(JSON.stringify(ex)).not.toContain(worker.name);
  await page.context().close();
});

test("halaman tahunan per pekerja: baris wawancara dengan status form, PDF gabungan, wawancara karena kejadian terpisah; tahun fiskal lain kosong", async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto(`/records/workers/${worker.id}/annual?fy=2020`);
  await expect(page.getByTestId("wannual-title")).toContainText("2020/4-2021/3");
  const r = page.locator('[data-testid=wannual-row][data-month="2020-05"]');
  await expect(r).toHaveAttribute("data-quarter", "1");
  await expect(r).toHaveAttribute("data-form", "filled");
  await expect(r.getByTestId("wannual-pdf")).toBeVisible();
  await expect(page.getByTestId("wannual-pdf-all")).toHaveAttribute("href", `/records/export/form55-year/${worker.id}?fy=2020`);
  await expect(page.getByTestId("wannual-events")).toBeVisible();
  await page.goto(`/records/workers/${worker.id}/annual?fy=2022`);
  await expect(page.getByTestId("wannual-empty")).toBeVisible();
  await expect(page.getByTestId("wannual-pdf-all")).toHaveCount(0);
  // wawancara karena kejadian: catatan ② seed yang menyebut pekerja tampil di bagian terpisah (berlabel), bukan di tabel 定期面談
  const [ev] = await ownerQuery<{ id: string; fy: number }>(
    `select s.candidate_id::text as id, case when extract(month from r.record_date) >= 4 then extract(year from r.record_date)::int else extract(year from r.record_date)::int - 1 end as fy
       from activity_records r join activity_record_subjects s on s.record_id = r.id where r.kind = 'meeting' and r.status = 'active' order by r.record_date desc limit 1`);
  expect(ev, "seed harus memuat notulen yang menyebut pekerja").toBeTruthy();
  await page.goto(`/records/workers/${ev.id}/annual?fy=${ev.fy}`);
  await expect(page.getByTestId("wannual-event").first()).toContainText("Karena kejadian");
  await expect(page.getByTestId("wannual-table").getByTestId("wannual-event")).toHaveCount(0);
  // tahun fiskal berjalan: wawancara seed muncul dan ada tautan balik ke daftar tahunan
  await page.goto("/records/interviews/annual");
  await expect(page.getByTestId("annual-worker-link").first()).toBeVisible();
  await page.context().close();
});

test("ponsel (390px): form 5-5 dan halaman tahunan tanpa scroll horizontal", async ({ browser }) => {
  const page = await staffPage(browser, "tsk.staff@hashi.test", { width: 390, height: 800 });
  for (const url of [`/records/interviews/${worker.id}/${MONTH}`, `/records/workers/${worker.id}/annual?fy=2020`]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, url).toBeLessThanOrEqual(0);
  }
  await page.context().close();
});

test("対応者 bawaan = penanggung jawab pekerja (bila ada); diganti per wawancara", async ({ browser }) => {
  test.skip(!responsible, "seed tanpa penanggung jawab tingkat penempatan");
  const page = await staffPage(browser);
  // bulan 2020-06 tanpa wawancara: pilihan staf terisi bawaan dari penanggung jawab
  await page.goto(`/records/interviews/${responsible!.workerId}/2020-06-01`);
  await expect(page.locator("#staffId")).toHaveValue(responsible!.staffId);
  await page.context().close();
});

test("LPK_ADMIN dan sensei: halaman tahunan dan kedua PDF = 404", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test"]) {
    const page = await staffPage(browser, email);
    expect((await page.goto(`/records/workers/${worker.id}/annual?fy=2020`))?.status()).toBe(404);
    expect((await page.request.get(`/records/export/form55/${worker.id}/${MONTH}`)).status()).toBe(404);
    expect((await page.request.get(`/records/export/form55-year/${worker.id}?fy=2020`)).status()).toBe(404);
    await page.context().close();
  }
});
