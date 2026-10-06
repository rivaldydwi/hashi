import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { login, ownerQuery, unique } from "./helpers";

// Lembar klien (langkah 6): ekspor profil klien dan lembar job order (internal / dibagikan), dialog + konfirmasi, label dua bahasa, bagian kosong dilewati,
// audit tanpa isi, LPK 404. Hanya data buatan tes ini (nama berisi run); data seed hanya DIBACA.

test.describe.configure({ mode: "serial" });

const run = unique();
const COMPANY = `株式会社シート${run}`;
const SITE = `シート工場${run}`;
const EMPTY_COMPANY = `株式会社カラ${run}`;
const PIC = `担当ひみつ${run}`;
const PIC_PHONE = `090-1234-${String(run).slice(-4)}`;
const NOTE_CO = `社内メモ会社${run}`;
const NOTE_JO = `社内メモ求人${run}`;
const STAFF_NAME = "Rina Staf TSK"; // tsk.staff@hashi.test
const startedAt = new Date();
let companyId = "";
let siteId = "";
let jobOrderId = "";
let emptyCompanyId = "";
let emptyJobOrderId = "";

test.beforeAll(async () => {
  const [org] = await ownerQuery<{ id: string }>("select id from organizations where name = 'TSK Demo Tokyo'");
  const [co] = await ownerQuery<{ id: string }>(
    "insert into client_companies (org_id, name, hq_address, industry, employee_count, foreign_worker_experience, public_intro, note) values ($1,$2,'静岡県テスト市1-1-1','食品製造',250,'2021年から受け入れ','安全で清潔な職場です。',$3) returning id",
    [org.id, COMPANY, NOTE_CO],
  );
  companyId = co.id;
  const [site] = await ownerQuery<{ id: string }>("insert into client_sites (org_id, company_id, name, address, phone, access_note) values ($1,$2,$3,'静岡県テスト市2-2-2','054-000-0000','JRテスト駅から徒歩5分') returning id", [org.id, companyId, SITE]);
  siteId = site.id;
  await ownerQuery("insert into client_site_fields (site_id, field_id, org_id) select $1, id, $3 from skill_fields where code = $2", [siteId, "food", org.id]);
  await ownerQuery("insert into client_site_contacts (org_id, site_id, role_title, name, phone) values ($1,$2,'工場長',$3,$4)", [org.id, siteId, PIC, PIC_PHONE]);
  const [jo] = await ownerQuery<{ id: string }>(
    `insert into job_orders (org_id, site_id, field_id, title, positions, status, min_jlpt, jft_required, gender_requirement, target_start_date, application_deadline, description, monthly_salary, salary_note,
       work_hours, days_off, housing, housing_note, commute_note, benefits_note, note)
     select $1,$2,id,$3,3,'OPEN','N4',false,'MALE','2026-12-01','2026-11-20','惣菜の製造補助',185000,'残業手当別','8:00〜17:00','週休2日','provided','個室','徒歩10分','社会保険完備',$4 from skill_fields where code = 'food' returning id`,
    [org.id, siteId, `製造スタッフ${run}`, NOTE_JO],
  );
  jobOrderId = jo.id;
  // perusahaan + job order tanpa informasi lembar (menguji bagian kosong dan petunjuk kelengkapan)
  const [eco] = await ownerQuery<{ id: string }>("insert into client_companies (org_id, name) values ($1,$2) returning id", [org.id, EMPTY_COMPANY]);
  emptyCompanyId = eco.id;
  const [esite] = await ownerQuery<{ id: string }>("insert into client_sites (org_id, company_id, name) values ($1,$2,$3) returning id", [org.id, emptyCompanyId, `カラ事業所${run}`]);
  await ownerQuery("insert into client_site_fields (site_id, field_id, org_id) select $1, id, $3 from skill_fields where code = $2", [esite.id, "food", org.id]);
  const [ejo] = await ownerQuery<{ id: string }>("insert into job_orders (org_id, site_id, field_id, title, positions) select $1,$2,id,$3,1 from skill_fields where code = 'food' returning id", [org.id, esite.id, `空の求人${run}`]);
  emptyJobOrderId = ejo.id;
});

test.afterAll(async () => {
  await ownerQuery("delete from job_orders where site_id in (select id from client_sites where company_id = any($1::uuid[]))", [[companyId, emptyCompanyId]]);
  await ownerQuery("delete from client_companies where id = any($1::uuid[])", [[companyId, emptyCompanyId]]);
});

async function pdfText(bytes: Buffer): Promise<{ text: string; pages: number }> {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return { text: out.join("\n").replace(/\s+/g, ""), pages: doc.numPages };
}

async function download(page: Page, testid: string): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testid).click()]);
  return { name: dl.suggestedFilename(), bytes: await readFile((await dl.path())!) };
}

test("profil klien: dialog, pratinjau dan PDF internal memuat telepon PIC, catatan internal, syarat gender, nama staf; nama berkas netral", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(`/clients/${companyId}`);
  await page.getByTestId("export-company-open").click();
  await expect(page.getByTestId("export-company-dialog")).toBeVisible();
  const preview = page.getByTestId("sheet-preview");
  await expect(preview).toHaveAttribute("data-mode", "internal");
  await expect(preview).toContainText(COMPANY);
  await expect(preview).toContainText(PIC_PHONE);
  await expect(preview).toContainText(NOTE_CO);
  await expect(preview).toContainText("男性");
  await expect(page.getByTestId("sheet-badge")).toContainText("社内用");
  await expect(page.getByTestId("sheet-excluded")).toHaveCount(0);
  const { name, bytes } = await download(page, "sheet-download");
  expect(name).toMatch(/^profil-klien-\d{8}\.pdf$/);
  expect(name).not.toContain(run);
  const { text } = await pdfText(bytes);
  for (const v of ["取引先プロフィール", "社内用", COMPANY, "食品製造", "250名", "安全で清潔な職場です。", SITE, "JRテスト駅から徒歩5分", PIC, PIC_PHONE, NOTE_CO, "男性", STAFF_NAME, "備考（社内用）"]) expect(text, `hilang: ${v}`).toContain(v.replace(/\s+/g, ""));
});

test("profil klien: mode dibagikan = daftar yang tidak disertakan, unduh terkunci sampai konfirmasi, PDF tanpa telepon/catatan/gender/nama staf", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(`/clients/${companyId}`);
  await page.getByTestId("export-company-open").click();
  await page.getByTestId("mode-share").check();
  const preview = page.getByTestId("sheet-preview");
  await expect(preview).toHaveAttribute("data-mode", "share");
  await expect(page.getByTestId("sheet-excluded")).toBeVisible();
  await expect(page.getByTestId("sheet-excluded").locator("li")).toHaveCount(4);
  await expect(preview).toContainText(PIC); // nama dan jabatan tetap
  for (const bad of [PIC_PHONE, NOTE_CO, "男性"]) await expect(preview).not.toContainText(bad);
  await expect(page.getByTestId("sheet-download")).toHaveCount(0);
  await expect(page.getByTestId("sheet-download-disabled")).toBeDisabled();
  await page.getByTestId("sheet-confirm").check();
  const { name, bytes } = await download(page, "sheet-download");
  expect(name).toMatch(/^profil-klien-\d{8}\.pdf$/);
  const { text } = await pdfText(bytes);
  for (const v of ["提供用", COMPANY, PIC, "工場長", "食品製造", SITE]) expect(text, `hilang: ${v}`).toContain(v);
  for (const bad of [PIC_PHONE, NOTE_CO, "男性", "性別条件", STAFF_NAME, "社内用", "備考（社内用）"]) expect(text, `bocor: ${bad}`).not.toContain(bad.replace(/\s+/g, ""));
  // mengganti ke internal lagi dan kembali ke dibagikan: konfirmasi harus diulang
  await page.getByTestId("mode-internal").check();
  await page.getByTestId("mode-share").check();
  await expect(page.getByTestId("sheet-download-disabled")).toBeVisible();
});

test("lembar job order dua bahasa label; gaji ¥; syarat gender hanya internal; PIC hanya internal", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  await page.goto(`/job-orders/${jobOrderId}`);
  await page.getByTestId("export-job-order-open").click();
  await page.getByTestId("lang-jaid").check();
  const preview = page.getByTestId("sheet-preview");
  await expect(preview).toContainText("勤務時間 / Jam kerja");
  await expect(preview).toContainText("¥185,000 / 月 (bulan)");
  await expect(preview).toContainText("寮あり / Asrama tersedia");
  await expect(preview).toContainText("男性");
  await expect(preview).toContainText(PIC_PHONE);
  const internal = await download(page, "sheet-download");
  expect(internal.name).toMatch(/^lembar-job-order-\d{8}\.pdf$/);
  const ti = await pdfText(internal.bytes);
  for (const v of ["求人票", "社内用/Hanyainternal", "勤務時間/Jamkerja", "¥185,000/月(bulan)", "惣菜の製造補助", "8:00〜17:00", "週休2日", "寮あり/Asramatersedia個室", "徒歩10分", "社会保険完備", "日本語能力試験N4以上", "2026年12月1日", "2026年11月20日", "男性", PIC, PIC_PHONE, NOTE_JO]) expect(ti.text, `hilang: ${v}`).toContain(v);
  expect(ti.pages).toBeLessThanOrEqual(2); // internal memuat PIC + catatan tambahan
  await page.getByTestId("mode-share").check();
  await page.getByTestId("sheet-confirm").check();
  const shared = await download(page, "sheet-download");
  const ts = await pdfText(shared.bytes);
  for (const v of ["提供用/Untukdibagikan", "¥185,000/月(bulan)", "惣菜の製造補助", "JRテスト駅から徒歩5分"]) expect(ts.text, `hilang: ${v}`).toContain(v);
  for (const bad of [PIC, PIC_PHONE, NOTE_JO, "男性", "性別条件", "Rina", "田中"]) expect(ts.text, `bocor: ${bad}`).not.toContain(bad);
  expect(ts.pages, "lembar job order versi dibagikan muat satu halaman").toBe(1);
});

test("bagian kosong dilewati dan petunjuk kelengkapan tampil (profil klien dan lembar job order kosong), tanpa menghalangi ekspor", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(`/clients/${emptyCompanyId}`);
  await page.getByTestId("export-company-open").click();
  await expect(page.getByTestId("sheet-missing")).toContainText("jenis usaha");
  await expect(page.getByTestId("sheet-skipped")).toBeVisible();
  await expect(page.getByTestId("sheet-section-intro")).toHaveCount(0);
  await expect(page.getByTestId("sheet-section-openings")).toHaveCount(1); // job order OPEN uji ada, jadi bagian lowongan tampil
  await expect(page.getByTestId("sheet-skipped")).toContainText("紹介文");
  const { bytes } = await download(page, "sheet-download");
  const { text } = await pdfText(bytes);
  expect(text).toContain(EMPTY_COMPANY);
  for (const absent of ["紹介文", "従業員数", "N/A"]) expect(text).not.toContain(absent);
  await page.goto(`/job-orders/${emptyJobOrderId}`);
  await page.getByTestId("export-job-order-open").click();
  await expect(page.getByTestId("sheet-missing")).toContainText("jam kerja");
  await expect(page.getByTestId("sheet-missing")).toContainText("tempat tinggal");
  const jo = await pdfText((await download(page, "sheet-download")).bytes);
  for (const absent of ["勤務時間", "休日・休暇", "住居", "福利厚生"]) expect(jo.text).not.toContain(absent);
  expect(jo.text).toContain(`空の求人${run}`);
});

test("tombol di halaman lokasi membatasi profil ke lokasi itu; rute ekspor: mode dibagikan tanpa konfirmasi 400, parameter salah 400, tanpa login 401", async ({ page, request }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(`/clients/${companyId}/sites/${siteId}`);
  await expect(page.getByTestId("export-company-open")).toBeVisible();
  const ok = await page.request.get(`/sheet/company/${companyId}?mode=internal&lang=ja&site=${siteId}`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("application/pdf");
  expect(ok.headers()["content-disposition"]).toMatch(/profil-klien-\d{8}\.pdf/);
  expect((await page.request.get(`/sheet/company/${companyId}?mode=share&lang=ja`)).status()).toBe(400);
  expect((await page.request.get(`/sheet/job-order/${jobOrderId}?mode=share&lang=jaid`)).status()).toBe(400);
  expect((await page.request.get(`/sheet/company/${companyId}?mode=bogus&lang=ja`)).status()).toBe(400);
  expect((await page.request.get(`/sheet/company/${companyId}?mode=internal&lang=xx`)).status()).toBe(400);
  expect((await page.request.get(`/sheet/company/${emptyCompanyId}?mode=internal&lang=ja&site=${siteId}`)).status()).toBe(404); // lokasi bukan milik perusahaan itu
  expect((await page.request.get(`/sheet/company/not-a-uuid?mode=internal`)).status()).toBe(404);
  expect((await request.get(`/sheet/company/${companyId}?mode=internal&lang=ja`)).status()).toBe(401);
});

test("form 'Informasi untuk lembar': bagian lipat di form perusahaan, lokasi, dan job order; terisi, tersimpan, dan terbuka sendiri", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(`/clients/${emptyCompanyId}`);
  const sec = page.getByTestId("sheet-section-company");
  await expect(sec).toBeVisible();
  await expect(sec).not.toHaveAttribute("open", "");
  await sec.locator("summary").click();
  await sec.locator("#company-industry").fill("介護施設");
  await sec.locator("#company-employeeCount").fill("40");
  await sec.locator("#company-publicIntro").fill("やさしい職場です。");
  await page.getByTestId("form-company-edit").getByTestId("client-submit").click();
  await expect(page.getByTestId("form-company-edit").locator("p[role=status], p[role=alert]").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("sheet-section-company")).toHaveAttribute("open", ""); // sudah ada isi -> terbuka
  await expect(page.locator("#company-industry")).toHaveValue("介護施設");
  await expect(page.locator("#company-employeeCount")).toHaveValue("40");
  await page.goto(`/job-orders/${emptyJobOrderId}`);
  const jsec = page.getByTestId("sheet-section-jobOrder");
  await jsec.locator("summary").click();
  await jsec.locator("#jo-workHours").fill("9:00〜18:00");
  await jsec.locator("#jo-housing").selectOption("allowance");
  await page.getByTestId("form-job-order-edit").getByTestId("client-submit").click();
  await expect(page.getByTestId("form-job-order-edit").locator("p[role=status], p[role=alert]").first()).toBeVisible();
  await expect(page.getByTestId("form-job-order-edit").locator("p[role=alert]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#jo-workHours")).toHaveValue("9:00〜18:00");
  await expect(page.locator("#jo-housing")).toHaveValue("allowance");
  // audit: nilai pilihan (housing) tercatat, teks bebas tidak
  const rows = await ownerQuery<{ before: unknown; after: unknown }>("select before, after from audit_logs where action = 'job_order.update' and entity_id = $1 and created_at >= $2", [emptyJobOrderId, startedAt]);
  expect(rows.length).toBeGreaterThan(0);
  const dump = JSON.stringify(rows);
  expect(dump).toContain("allowance");
  expect(dump).not.toContain("9:00");
  expect(dump).toContain("workHours");
  const co = await ownerQuery<{ before: unknown; after: unknown }>("select before, after from audit_logs where action = 'client_company.update' and entity_id = $1 and created_at >= $2", [emptyCompanyId, startedAt]);
  expect(JSON.stringify(co)).not.toContain("やさしい");
  expect(JSON.stringify(co)).not.toContain("介護施設");
});

test("audit ekspor: jenis, mode, bahasa label, jumlah halaman; TANPA nama perusahaan, PIC, atau isi", async () => {
  const rows = await ownerQuery<{ action: string; entity: string; before: unknown; after: Record<string, unknown>; actor_org_id: string }>(
    "select action, entity, before, after, actor_org_id from audit_logs where action = 'client_sheet_export' and created_at >= $1 order by created_at",
    [startedAt],
  );
  expect(rows.length).toBeGreaterThanOrEqual(6);
  for (const r of rows) {
    expect(Object.keys(r.after).sort()).toEqual(["labelLang", "mode", "pages", "sheetKind"]);
    expect(["company", "jobOrder"]).toContain(r.after.sheetKind);
    expect(["internal", "share"]).toContain(r.after.mode);
    expect(["ja", "jaid"]).toContain(r.after.labelLang);
    expect(r.after.pages as number).toBeGreaterThan(0);
    const dump = JSON.stringify(r);
    for (const secret of [COMPANY, EMPTY_COMPANY, PIC, PIC_PHONE, NOTE_CO, NOTE_JO, "シート"]) expect(dump).not.toContain(secret);
  }
  expect(rows.some((r) => r.after.mode === "share") && rows.some((r) => r.after.mode === "internal") && rows.some((r) => r.after.labelLang === "jaid") && rows.some((r) => r.after.sheetKind === "jobOrder")).toBe(true);
});

test("LPK_ADMIN dan sensei: rute ekspor 404, tidak ada menu Klien/Job order; super admin juga 404", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test", "admin@hashi.test"]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, email);
    for (const path of [`/sheet/company/${companyId}?mode=internal&lang=ja`, `/sheet/company/${companyId}?mode=share&lang=ja&confirm=1`, `/sheet/job-order/${jobOrderId}?mode=internal&lang=ja`, `/sheet/job-order/${jobOrderId}?mode=share&lang=jaid&confirm=1`]) {
      expect((await page.request.get(path)).status(), `${email} ${path}`).toBe(404);
    }
    expect((await page.goto(`/clients/${companyId}`))?.status()).toBe(404);
    expect((await page.goto(`/job-orders/${jobOrderId}`))?.status()).toBe(404);
    await page.goto("/");
    await expect(page.locator('[data-testid=sidebar] a[href="/clients"], [data-testid=sidebar] a[href="/job-orders"]')).toHaveCount(0);
    await ctx.close();
  }
});
