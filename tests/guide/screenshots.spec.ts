import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login, ownerQuery } from "../e2e/helpers";
import { DESKTOP, IMG, isoDay, open, openDetails, PHONE, shot } from "./lib";

// Tangkapan layar buku panduan (T-030): `npm run guide:shots`. Hanya jalan bila GUIDE_SHOTS=1, terhadap database DEV
// (reseed dasar + seed:pilot). Skenario MENAMBAH data (satu siswa, satu klien, dst.), jadi selalu reseed dulu.
test.skip(!process.env.GUIDE_SHOTS, "set GUIDE_SHOTS=1 (npm run guide:shots)");
test.describe.configure({ mode: "serial" });

const NAME = "Dewi Lestari Panduan";
const SHARED: { cid: string } = { cid: "" };
test.beforeAll(async () => {
  // Skenario berakhir dengan siswa BERANGKAT (tidak bisa dihapus): selalu mulai dari database yang baru di-reseed (`npm run guide:shots`).
  const [dup] = await ownerQuery<{ n: string }>("select count(*) as n from candidates where full_name = $1", [NAME]);
  if (!process.env.GUIDE_KEEP) for (const f of readdirSync(IMG).filter((n) => n.endsWith(".png"))) rmSync(path.join(IMG, f)); // tanpa gambar yatim
  if (process.env.GUIDE_KEEP) {
    // Hanya untuk menyusun skrip: lanjutkan di siswa contoh yang sudah ada (jangan dipakai untuk hasil akhir).
    [{ id: SHARED.cid }] = await ownerQuery<{ id: string }>("select id::text as id from candidates where full_name = $1", [NAME]);
    return;
  }
  if (Number(dup.n) > 0) throw new Error("Siswa contoh sudah ada: reseed dulu (npm run guide:shots melakukannya otomatis).");
});

const PDF = Buffer.from("%PDF-1.4\n% dokumen contoh untuk buku panduan (dummy)\n%%EOF\n");

async function fill(page: Page, id: string, value: string) {
  await page.locator(id).fill(value);
}

test("00 Mulai: login, beranda, bahasa, akun, dashboard", async ({ browser }) => {
  const anon = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await anon.goto("/login");
  await anon.getByTestId("demo-accounts").locator("summary").click();
  await shot(anon, "00-login");
  const lpk = await open(browser, "lpk");
  await shot(lpk, "00-beranda-lpk");
  await shot(lpk, "00-pilihan-bahasa", { clip: { x: 0, y: 640, width: 260, height: 160 } });
  await lpk.getByTestId("account-menu").locator("summary").click();
  await shot(lpk, "00-menu-akun", { clip: { x: 0, y: 560, width: 260, height: 240 } });
  await lpk.getByTestId("account-menu").locator("summary").click();
  await lpk.goto("/account");
  await shot(lpk, "00-akun-saya");
  await lpk.goto("/?atur=1");
  await shot(lpk, "00-atur-dashboard");
  const tsk = await open(browser, "tsk");
  await shot(tsk, "00-beranda-tsk");
  const phone = await open(browser, "lpk", PHONE);
  await shot(phone, "00-beranda-ponsel");
});

test("A1 LPK: daftar kandidat, form tambah, simpan", async ({ browser }) => {
  const lpk = await open(browser, "lpk");
  await lpk.goto("/candidates");
  await shot(lpk, "a-01-daftar-kandidat", { mark: [lpk.getByTestId("candidate-filters")] });
  await lpk.goto("/candidates/new");
  await shot(lpk, "a-02-form-tambah");
  await fill(lpk, "#basic-fullName", NAME);
  await lpk.locator("#basic-gender").selectOption("FEMALE");
  await fill(lpk, "#basic-birthDate", "2002-06-12");
  await lpk.locator("#basic-fieldId").selectOption({ label: "Pengolahan makanan & minuman" });
  await fill(lpk, "#basic-nameKatakana", "デウィ・レスタリ");
  await fill(lpk, "#basic-birthPlace", "Bandung");
  await fill(lpk, "#about-motivation", "Ingin belajar teknik pengolahan makanan Jepang dan membawa ilmunya pulang.");
  await fill(lpk, "#contact-address", "Jl. Contoh No. 1, Bandung");
  await lpk.evaluate(() => window.scrollTo(0, 0));
  await lpk.locator("#basic-fullName").blur();
  await shot(lpk, "a-03-form-terisi", { mark: [lpk.getByTestId("completeness")] });
  await lpk.getByTestId("save-candidate").click();
  await lpk.waitForURL(/\/candidates\/[0-9a-f-]{36}\?added=1/);
  SHARED.cid = lpk.url().split("/").pop()!.split("?")[0];
  await shot(lpk, "a-04-detail-baru");
});

test("A2 LPK: dokumen, penilaian bulanan, berbagi ke TSK", async ({ browser }) => {
  const lpk = await open(browser, "lpk");
  await lpk.goto(`/candidates/${SHARED.cid}`);
  await openDetails(lpk.locator("[data-testid=section-documents] details > summary").last());
  await lpk.locator("#doc-type").selectOption("PASSPORT");
  await lpk.locator("#doc-file").setInputFiles({ name: "paspor-contoh.pdf", mimeType: "application/pdf", buffer: PDF });
  await shot(lpk, "a-05-unggah-dokumen", { of: lpk.getByTestId("section-documents") });
  await lpk.locator("[data-testid=form-document-upload] button[type=submit]").click();
  await expect(lpk.getByTestId("document-row")).toHaveCount(1);
  const form = lpk.getByTestId("form-assessment-add");
  if (!(await form.isVisible())) await lpk.getByTestId("assessment-add-toggle").click();
  for (const [n, v] of [["scoreJapanese", "4"], ["scoreAttitude", "5"], ["scoreFitness", "4"], ["scoreMotivation", "5"]]) await form.locator(`#assessment-${n}`).selectOption(v);
  await form.locator("#assessment-attendancePct").fill("96");
  await form.locator("#assessment-note").fill("Aktif di kelas, cepat menghafal kosakata dapur.");
  await shot(lpk, "a-06-form-penilaian", { of: lpk.locator("section:has([data-testid=assessment-add-toggle])") });
  await form.getByTestId("assessment-submit").click();
  await expect(lpk.getByTestId("assessment-row").or(lpk.getByTestId("assessment-card")).first()).toBeVisible();
  await shot(lpk, "a-07-penilaian-tersimpan", { of: lpk.locator("section:has([data-testid=assessment-add-toggle])") });
  await lpk.locator("#stage").selectOption("READY");
  await lpk.getByTestId("form-stage").locator("button[type=submit]").click();
  await lpk.waitForLoadState("networkidle");
  await shot(lpk, "a-08-status-dan-berbagi", { of: lpk.getByTestId("section-sharing"), mark: [lpk.getByTestId("sharing-form")] });
  await lpk.getByTestId("sharing-confirm").check();
  await lpk.getByTestId("sharing-enable-form").locator("button[type=submit]").click();
  await expect(lpk.getByTestId("sharing-state")).toHaveText("Dibagikan ke TSK mitra");
  await shot(lpk, "a-09-sudah-dibagikan", { of: lpk.getByTestId("section-sharing") });
});

// ---- Skenario B: dari shortlist sampai berangkat (TSK), LPK melihat statusnya -------------------------------------------------
const JO: { id: string; company: string; site: string } = { id: "", company: "", site: "" };
const COMPANY = "株式会社さくら製パン（ガイド用）";
const SITE = "さくら製パン 本社工場";
const JO_TITLE = "製パンスタッフ（ガイド用）";
const sectionOf = (p: Page, tid: string) => p.getByTestId(tid);

test("B1 TSK: melihat kandidat dibagikan, keputusan shortlist, catatan TSK", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  await tsk.goto(`/candidates?q=${encodeURIComponent("Dewi Lestari")}`);
  await shot(tsk, "b-01-daftar-kandidat-tsk");
  await tsk.goto(`/candidates/${SHARED.cid}`);
  await tsk.locator("#decision").selectOption("SHORTLISTED");
  await shot(tsk, "b-02-keputusan-shortlist", { of: tsk.getByTestId("section-decision") });
  await tsk.locator("[data-testid=form-decision] button[type=submit]").click();
  await tsk.waitForLoadState("networkidle");
  await tsk.getByTestId("form-note-add").scrollIntoViewIfNeeded();
  await tsk.locator("#note-body").fill("Wawancara awal baik. Bahasa Jepang cukup untuk dapur. Cocok untuk perusahaan roti dan makanan.");
  await shot(tsk, "b-03-catatan-tsk", { of: tsk.getByTestId("section-notes") });
  await tsk.getByTestId("form-note-add").locator("button[type=submit]").click();
  await tsk.waitForLoadState("networkidle");
});

test("B2 TSK: klien, lokasi, PIC, job order", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  await tsk.goto("/clients/new");
  await tsk.locator("#company-name").fill(COMPANY);
  await shot(tsk, "b-04-klien-baru");
  await tsk.getByTestId("client-submit").click();
  await tsk.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  await tsk.getByTestId("site-add").click();
  await tsk.locator("#site-name").fill(SITE);
  await tsk.locator("input[name=fieldIds][data-code=food]").check();
  await shot(tsk, "b-05-lokasi-bidang");
  await tsk.getByTestId("client-submit").click();
  await tsk.waitForURL(/\/sites\/[0-9a-f-]{36}$/);
  await tsk.locator("#contact-roleTitle").fill("工場長");
  await tsk.locator("#contact-name").fill("佐藤 一郎");
  await shot(tsk, "b-06-pic", { of: tsk.getByTestId("form-contact-add") });
  await tsk.getByTestId("form-contact-add").getByTestId("client-submit").click();
  await expect(tsk.getByTestId("contact")).toHaveCount(1);
  await tsk.goto("/job-orders");
  await shot(tsk, "b-07-daftar-job-order");
  await tsk.getByTestId("primary-action").click();
  await shot(tsk, "b-08-pilih-lokasi");
  await tsk.locator(`[data-testid=site-option]:has-text("${SITE}") [data-testid=site-choose]`).click();
  await tsk.locator("#jo-title").fill(JO_TITLE);
  await tsk.locator("#jo-fieldId").selectOption({ label: "Pengolahan makanan & minuman" });
  await tsk.locator("#jo-positions").fill("1");
  await shot(tsk, "b-09-form-job-order");
  await tsk.getByTestId("client-submit").click();
  await tsk.waitForURL(/\/job-orders\/[0-9a-f-]{36}/);
  JO.id = tsk.url().split("/job-orders/")[1].split(/[?#]/)[0];
  await shot(tsk, "b-10-job-order-terbuka", { mark: [tsk.getByTestId("job-order-status")] });
});

test("B3 TSK: kandidat cocok, interview, ajukan, lulus klien, dokumen, berangkat", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  const candidateUrl = `/candidates/${SHARED.cid}`;
  await tsk.goto(`/job-orders/${JO.id}?tab=match`);
  const row = tsk.locator(`[data-testid=match-row][data-candidate="${NAME}"]`);
  await shot(tsk, "b-11-kandidat-cocok", { mark: [row] });
  // wawancara TSK lulus (keputusan umum), lalu form penilaian interview terbuka
  await tsk.goto(candidateUrl);
  await tsk.locator("#decision").selectOption("PASSED_TSK_INTERVIEW");
  await tsk.locator("[data-testid=form-decision] button[type=submit]").click();
  await tsk.waitForLoadState("networkidle");
  await tsk.goto(candidateUrl);
  await tsk.getByTestId("tsk-interview-toggle").click();
  const prefix = "tsk-interview";
  const f = tsk.locator(`[data-testid^=form-tsk-assessment], form:has(#${prefix}-assessedOn)`).first();
  for (const [n, v] of [["scoreJapanese", "4"], ["scoreAttitude", "5"], ["scoreFitness", "4"], ["scoreMotivation", "5"]]) await f.locator(`#${prefix}-${n}`).selectOption(v);
  await f.locator(`#${prefix}-note`).fill("Menjawab dengan jelas dan sopan. Siap bekerja shift pagi.");
  await shot(tsk, "b-12-penilaian-interview", { of: tsk.getByTestId("section-tsk-assessments") });
  await f.getByTestId("assessment-submit").click();
  await tsk.waitForLoadState("networkidle");
  // ajukan ke klien dari daftar kandidat cocok
  await tsk.goto(`/job-orders/${JO.id}?tab=match`);
  await row.getByTestId("propose-button").click();
  await expect(row.getByTestId("match-proposed")).toBeVisible();
  await shot(tsk, "b-13-diajukan", { mark: [row] });
  // lulus interview klien, proses dokumen, berangkat (keputusan untuk job order ini)
  for (const [decision, name] of [["PASSED_CLIENT_INTERVIEW", "b-14-lulus-interview-klien"], ["DOCUMENT_PROCESS", "b-15-proses-dokumen"], ["DEPARTED", "b-16-berangkat"]] as const) {
    await tsk.goto(candidateUrl);
    await tsk.locator("#decision-job-order").selectOption(JO.id);
    await tsk.locator("#decision").selectOption(decision);
    if (name !== "b-16-berangkat") await shot(tsk, name, { of: tsk.getByTestId("section-decision") });
    await tsk.locator("[data-testid=form-decision] button[type=submit]").click();
    await tsk.waitForLoadState("networkidle");
  }
  await tsk.goto(candidateUrl);
  await expect(tsk.getByTestId("section-placement")).toBeVisible();
  await shot(tsk, "b-16-berangkat", { of: tsk.getByTestId("section-placement") });
  await tsk.goto(`/job-orders/${JO.id}`);
  await shot(tsk, "b-17-job-order-terisi", { mark: [tsk.getByTestId("job-order-status")] });
});

test("B4 TSK: lembar klien PDF (internal dan dibagikan)", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  const [co] = await ownerQuery<{ id: string }>("select id from client_companies where name = $1", [COMPANY]);
  await tsk.goto(`/clients/${co.id}`);
  await tsk.getByTestId("export-company-open").click();
  await expect(tsk.getByTestId("sheet-preview")).toBeVisible();
  await shot(tsk, "b-18-lembar-internal");
  await tsk.getByTestId("mode-share").check();
  await shot(tsk, "b-19-lembar-dibagikan");
  await tsk.getByTestId("sheet-close").click();
  await tsk.goto(`/job-orders/${JO.id}`);
  await tsk.getByTestId("export-job-order-open").click();
  await tsk.getByTestId("lang-jaid").check();
  await shot(tsk, "b-20-lembar-job-order");
});

test("B5 LPK melihat keputusan TSK; tanggal tiba mengisi status visa", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  await tsk.goto(`/records/workers/${SHARED.cid}`);
  await tsk.getByTestId("arrival-date").fill(isoDay(-3));
  await shot(tsk, "b-21-tanggal-tiba", { of: tsk.getByTestId("arrival-section") });
  await tsk.getByTestId("arrival-section").locator("button[type=submit]").click();
  await tsk.waitForLoadState("networkidle");
  const lpk = await open(browser, "lpk");
  await lpk.goto(`/candidates/${SHARED.cid}`);
  await shot(lpk, "b-22-lpk-keputusan-tsk", { of: lpk.getByTestId("section-decision") });
  await shot(lpk, "b-23-lpk-status-visa", { of: lpk.getByTestId("section-worker-status") });
});

// ---- Skenario C: kartu izin tinggal hampir habis -------------------------------------------------------------------------------
test("C TSK: kartu H-30, data perpanjangan, menunggu hasil, terima kartu baru", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  const url = `/records/workers/${SHARED.cid}`;
  await tsk.goto(url);
  await shot(tsk, "c-01-kartu-kosong", { of: tsk.getByTestId("card-section") });
  const create = tsk.getByTestId("card-create-form");
  await create.getByTestId("c-period").selectOption("12");
  await create.getByTestId("c-expiry").fill(isoDay(25));
  await shot(tsk, "c-02-isi-kartu", { of: tsk.getByTestId("card-section") });
  await create.locator("button[type=submit]").click();
  await expect(tsk.getByTestId("card-current")).toBeVisible();
  await shot(tsk, "c-03-kartu-h30", { of: tsk.getByTestId("card-current"), mark: [tsk.getByTestId("card-stage")] });
  await shot(tsk, "c-04-nomor-foto", { of: tsk.getByTestId("card-section"), maxHeight: 900 });
  // data perpanjangan online + PDF loket
  await tsk.goto(`${url}/renewal`);
  await shot(tsk, "c-05-data-perpanjangan", { of: tsk.locator("main"), maxHeight: 1700 });
  await shot(tsk, "c-05b-pdf-loket", { of: tsk.getByTestId("counter-section"), mark: [tsk.getByTestId("fee-form-link")] });
  // ajukan -> menunggu hasil
  await tsk.goto(url);
  await openDetails(tsk.getByTestId("card-edit-toggle"));
  const f = tsk.getByTestId("card-update-form");
  await f.getByTestId("u-status").selectOption("applied");
  await f.getByTestId("u-applied").fill(isoDay(-1));
  await shot(tsk, "c-06-ajukan", { of: f });
  await f.locator("button[type=submit]").click();
  await expect(tsk.getByTestId("card-stage")).toContainText("Menunggu hasil");
  await shot(tsk, "c-07-menunggu-hasil", { of: tsk.getByTestId("card-current"), mark: [tsk.getByTestId("card-stage")] });
  // terima kartu baru
  await openDetails(tsk.getByTestId("card-receive-toggle"));
  const r = tsk.getByTestId("card-receive-form");
  await r.getByTestId("r-on").fill(isoDay(0));
  await r.getByTestId("r-by").selectOption("staff");
  await r.getByTestId("r-expiry").fill(isoDay(366));
  await shot(tsk, "c-08-terima-kartu-baru", { of: r });
  await r.locator("button[type=submit]").click();
  await expect(tsk.getByTestId("card-history-item")).toHaveCount(2);
  await shot(tsk, "c-09-riwayat-kartu", { of: tsk.getByTestId("card-history") });
  await tsk.goto("/records/cards");
  await shot(tsk, "c-10-daftar-kartu");
  const staff = await open(browser, "staff");
  await staff.goto("/records/cards");
  await shot(staff, "c-11-daftar-kartu-staf", { mark: [staff.getByTestId("card-filter-mine")] });
  const lpk = await open(browser, "lpk");
  await lpk.goto(`/candidates/${SHARED.cid}`);
  await shot(lpk, "c-12-lpk-status-visa", { of: lpk.getByTestId("section-worker-status") });
});

test("C2 email pengingat (Mailpit lokal, tidak keluar dari komputer ini)", async ({ browser }) => {
  const MAILPIT = "http://127.0.0.1:8025/api/v1";
  await fetch(`${MAILPIT}/messages`, { method: "DELETE" });
  // SMTP dipaksa ke Mailpit lokal; nilai SMTP produksi di .env TIDAK dipakai (env eksplisit menang atas dotenv).
  execFileSync("npx", ["tsx", "scripts/reminder-worker.ts", "--once"], {
    env: { ...process.env, SMTP_URL: "smtp://127.0.0.1:1025", MAIL_FROM: "Hashi <hashi@hashi.test>", APP_URL: "https://hashi.example.test", REMINDER_ALLOW_TEST_RECIPIENTS: "1" },
    stdio: "pipe",
  });
  const list = (await (await fetch(`${MAILPIT}/messages`)).json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
  const mine = list.messages.find((m) => m.To.some((t) => t.Address === "tsk.admin@hashi.test"));
  expect(mine, "email pengingat untuk Admin TSK demo").toBeTruthy();
  const full = (await (await fetch(`${MAILPIT}/message/${mine!.ID}`)).json()) as { HTML: string; Subject: string };
  const page = await (await browser.newContext({ viewport: { width: 760, height: 640 } })).newPage();
  await page.setContent(`<body style="font:15px/1.5 system-ui,sans-serif;margin:0;background:#f4f1ec"><div style="max-width:700px;margin:16px auto;background:#fff;border:1px solid #ddd;border-radius:10px;padding:18px 22px"><p style="margin:0 0 10px;color:#555;font-size:13px">Kepada: tsk.admin@hashi.test<br>Subjek: <b>${full.Subject.replace(/</g, "&lt;")}</b></p><hr style="border:0;border-top:1px solid #eee">${full.HTML}</div></body>`);
  await shot(page, "c-13-email-pengingat");
});

// ---- Skenario D: masalah di tempat kerja ---------------------------------------------------------------------------------------
test("D TSK: catatan harian, kasus, notulen, tindak lanjut, wawancara berkala", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  await tsk.goto(`/records/new?kind=daily_work&worker=${SHARED.cid}`);
  await tsk.locator("#workType").selectOption("consultation");
  await tsk.locator("#actionTaken").fill("本人から寮の騒音について相談を受け、電話で配属先に状況を伝えた。");
  await tsk.locator("#result").fill("配属先が来週までに対応を検討する。");
  await shot(tsk, "d-01-catatan-harian-form");
  await tsk.getByTestId("save-record").click();
  await tsk.waitForURL(/\/records\/[0-9a-f-]{36}$/);
  const recordUrl = tsk.url();
  await shot(tsk, "d-02-catatan-tersimpan");
  await tsk.getByTestId("add-followup-toggle").click();
  await tsk.locator("#fu-desc").fill("3日後に配属先へ進捗を確認する。");
  await tsk.locator("#fu-due").fill(isoDay(3));
  await shot(tsk, "d-03-tindak-lanjut", { of: tsk.getByTestId("add-followup-form") });
  await tsk.getByTestId("add-followup-form").locator("button[type=submit]").click();
  await expect(tsk.getByTestId("followup-item")).toHaveCount(1);
  await tsk.goto("/records/cases/new");
  await tsk.locator("#title").fill("寮の騒音トラブル");
  await tsk.getByTestId(`worker-${SHARED.cid}`).check();
  await shot(tsk, "d-04-kasus-baru");
  await tsk.getByTestId("case-form").locator("button[type=submit]").click();
  await tsk.waitForURL(/\/records\/cases\/[0-9a-f-]{36}$/);
  const caseId = tsk.url().split("/").pop()!;
  await tsk.goto(`/records/new?kind=meeting&case=${caseId}`);
  await tsk.locator("#meetingSubject").fill("配属先との打合せ（騒音の件）");
  await tsk.getByTestId("add-point-consultation").click();
  await tsk.locator("#consultation-0").fill("部屋替えの可否について相談した。");
  await tsk.getByTestId("add-timeline-row").click();
  await tsk.getByTestId("tl-event").fill("配属先と打合せを実施、別室の確保を検討することになった。");
  await shot(tsk, "d-05-notulen-form");
  await tsk.getByTestId("save-record").click();
  await tsk.waitForURL(/\/records\/[0-9a-f-]{36}$/);
  await shot(tsk, "d-06-notulen-tersimpan");
  await tsk.goto(`/records/cases/${caseId}`);
  await shot(tsk, "d-07-kasus-kronologi");
  await tsk.goto(recordUrl.replace(/^https?:\/\/[^/]+/, ""));
  await shot(tsk, "d-08-tombol-pdf", { of: tsk.getByTestId("export-record").locator("xpath=.."), mark: [tsk.getByTestId("export-record")] });
  await tsk.goto("/records/tasks?scope=mine");
  await shot(tsk, "d-09-daftar-tindak-lanjut");
  await tsk.goto("/records");
  await shot(tsk, "d-10-catatan-kegiatan-laporan-harian", { mark: [tsk.getByTestId("daily-report-card")] });
  await tsk.goto("/records/interviews");
  await shot(tsk, "d-11-wawancara-berkala");
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  await tsk.goto(`/records/interviews/${SHARED.cid}/${month}`);
  await shot(tsk, "d-12-form-wawancara", { of: tsk.locator("main"), maxHeight: 1800 });
  await tsk.goto(`/records/workers/${SHARED.cid}/annual`);
  await shot(tsk, "d-13-form-5-5-tahunan");
  await tsk.goto("/records/responsible");
  await shot(tsk, "d-14-penanggung-jawab");
});

// ---- Bab fitur lain (LPK dan TSK) ------------------------------------------------------------------------------------------------
test("F1 LPK: filter, belum dinilai, pengguna, riwayat, hapus kandidat, tampilan Sensei", async ({ browser }) => {
  const lpk = await open(browser, "lpk");
  await lpk.goto("/candidates?stage=READY&avg=4&jlpt=N4");
  await shot(lpk, "f-01-filter-kandidat");
  await lpk.goto("/assessments/pending");
  await shot(lpk, "f-02-belum-dinilai");
  await lpk.goto("/users");
  await shot(lpk, "f-03-pengguna");
  await lpk.goto("/users/new");
  await shot(lpk, "f-04-pengguna-baru");
  await lpk.goto("/activity");
  await shot(lpk, "f-05-riwayat-aktivitas", { mark: [lpk.getByTestId("audit-export")] });
  // hapus permanen: dialog pada siswa contoh, dan penolakan pada siswa yang sudah berangkat
  const scratch = await ownerQuery<{ id: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
     select o.id, 'Contoh Salah Input', 'MALE', '2001-01-01', (select id from skill_fields where code = 'food'), 'STUDYING', false from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id`);
  await lpk.goto(`/candidates/${scratch[0].id}`);
  await lpk.getByTestId("delete-open").click();
  await shot(lpk, "f-06-hapus-dialog");
  await lpk.goto(`/candidates/${SHARED.cid}`);
  await shot(lpk, "f-07-hapus-ditolak", { of: lpk.getByTestId("danger-zone") });
  const sensei = await open(browser, "sensei");
  await sensei.goto("/");
  await shot(sensei, "f-08-beranda-sensei");
  await sensei.goto("/candidates");
  const [adi] = await ownerQuery<{ id: string }>("select id::text as id from candidates where full_name = 'Adi Aji Ramadhan'");
  await sensei.goto(`/candidates/${adi.id}`);
  await shot(sensei, "f-09-detail-sensei", { of: sensei.locator("main"), maxHeight: 1500 });
});

test("F2 TSK: daftar klien, filter kandidat, catatan lain, riwayat", async ({ browser }) => {
  const tsk = await open(browser, "tsk");
  await tsk.goto("/clients");
  await shot(tsk, "f-10-daftar-klien");
  await tsk.goto("/candidates?view=awaiting");
  await shot(tsk, "f-11-kandidat-menunggu-keputusan");
  await tsk.goto("/records/meetings");
  await shot(tsk, "f-12-notulen");
  await tsk.goto("/records/cases");
  await shot(tsk, "f-13-daftar-kasus");
  await tsk.goto("/records/reports");
  await shot(tsk, "f-14-laporan-harian-staf");
  await tsk.goto("/activity");
  await shot(tsk, "f-15-riwayat-tsk");
  const phone = await open(browser, "tsk", PHONE);
  await phone.goto("/records/new?kind=daily_work");
  await shot(phone, "f-16-ponsel-catatan-harian", { full: true, maxHeight: 1700 });
});
