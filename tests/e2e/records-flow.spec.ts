import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { login, ownerQuery, unique } from "./helpers";

// Alur utama Catatan kegiatan (langkah 7A): ① dengan foto, tanda baca, edit + riwayat, pembatalan, kasus + kronologi, tugas, laporan harian, validasi foto, audit.
// Memakai pekerja aktif dari seed; semua catatan uji ditandai dengan penanda unik.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date().toISOString();
const MARK1 = `記録テスト${run}`;
const MARK2 = `記録テスト変更後${run}`;
let worker = { id: "", name: "" };
let recordId = "";
let caseId = "";
const UUID_URL = /\/records\/[0-9a-f-]{36}$/;

test.beforeAll(async () => {
  [worker] = await ownerQuery<{ id: string; name: string }>("select c.id::text as id, c.full_name as name from placements p join candidates c on c.id = p.candidate_id where p.status = 'ACTIVE' order by c.full_name limit 1");
});

async function ctxPage(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await login(page, email);
  return page;
}

/** Isi form ① minimal lewat UI dan simpan; mengembalikan id catatan. */
async function createDaily(page: Page, action: string): Promise<string> {
  await page.goto(`/records/new?kind=daily_work&worker=${worker.id}`);
  await expect(page.getByTestId(`worker-${worker.id}`)).toBeChecked(); // pekerja terisi dari tautan
  await page.locator("#workType").selectOption("consultation");
  await page.locator("#actionTaken").fill(action);
  await page.getByTestId("save-record").click();
  await page.waitForURL(UUID_URL);
  return page.url().split("/").pop()!;
}

test("TSK_ADMIN membuat ① dengan foto ber-EXIF: tersimpan, thumbnail tampil, GPS dan EXIF dibuang, rotasi diterapkan", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.admin@hashi.test");
  await page.goto("/records/new?kind=daily_work");
  await page.getByTestId(`worker-${worker.id}`).check();
  await page.locator("#workType").selectOption("consultation");
  await page.locator("#actionTaken").fill(MARK1);
  await page.locator("#result").fill("問題なし");
  const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#2f5d8a" } })
    .withExif({ IFD0: { Copyright: `rahasia-${run}` }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 40/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "139/1 45/1 0/1" } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  await page.getByTestId("photo-input").setInputFiles({ name: "gps.jpg", mimeType: "image/jpeg", buffer: jpeg });
  const draft = page.getByTestId("photo-draft");
  await expect(draft).toHaveCount(1);
  await draft.locator("input[type=text], input:not([type])").first().fill("現場の写真");
  await draft.locator("input[type=checkbox]").check();
  await page.getByTestId("save-record").click();
  await page.waitForURL(UUID_URL);
  recordId = page.url().split("/").pop()!;
  await expect(page.getByTestId("record-title")).toHaveText("相談対応");
  await expect(page.getByTestId("attachment-item")).toHaveCount(1);
  const src = (await page.getByTestId("attachment-img").getAttribute("src"))!;
  const bytes = await (await page.request.get(src)).body();
  const meta = await sharp(bytes).metadata();
  expect(meta.exif).toBeUndefined();
  expect(bytes.toString("latin1")).not.toContain(`rahasia-${run}`);
  expect([meta.width, meta.height]).toEqual([100, 200]); // orientasi 6 diterapkan
  const [row] = await ownerQuery<{ mime: string; caption: string; include_in_pdf: boolean }>("select mime, caption, include_in_pdf from activity_attachments where record_id = $1", [recordId]);
  expect(row).toMatchObject({ mime: "image/jpeg", caption: "現場の写真", include_in_pdf: true });
  await page.context().close();
});

test("TSK_STAFF melihat catatan staf lain (belum dibaca), menandai sudah dibaca: daftar pembaca bertambah, penanda hilang", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  await page.goto("/records");
  const row = page.locator(`[data-record-id="${recordId}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("badge-unread")).toBeVisible();
  await row.click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await page.getByTestId("mark-read-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("reader").filter({ hasText: "Rina Staf TSK" })).toBeVisible();
  await page.goto("/records");
  await expect(page.locator(`[data-record-id="${recordId}"]`).getByTestId("badge-unread")).toHaveCount(0);
  await page.context().close();
});

test("staf bukan penulis tidak bisa mengubah atau membatalkan; rute edit 404", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/${recordId}`);
  await expect(page.getByTestId("record-title")).toBeVisible();
  await expect(page.getByTestId("edit-record")).toHaveCount(0);
  await expect(page.getByTestId("void-form")).toHaveCount(0);
  expect((await page.goto(`/records/${recordId}/edit`))?.status()).toBe(404);
  await page.context().close();
});

test("edit oleh penulis membuat versi baru: riwayat memuat nilai sebelum dan sesudah; pembaca lama melihat 'Diperbarui sejak kamu baca'", async ({ browser }) => {
  const admin = await ctxPage(browser, "tsk.admin@hashi.test");
  await admin.goto(`/records/${recordId}/edit`);
  await admin.locator("#actionTaken").fill(MARK2);
  await admin.getByTestId("save-record").click();
  await admin.waitForURL(UUID_URL);
  await expect(admin.getByTestId("badge-version")).toBeVisible();
  const items = admin.getByTestId("revision-item");
  await expect(items).toHaveCount(1);
  const diff = items.first().getByTestId("revision-diff").filter({ hasText: "対応内容" });
  await expect(diff.getByTestId("rev-before")).toHaveText(MARK1);
  await expect(diff.getByTestId("rev-after")).toHaveText(MARK2);
  const [r] = await ownerQuery<{ version_no: number }>("select version_no from activity_records where id = $1", [recordId]);
  expect(r.version_no).toBe(2);
  await admin.context().close();

  const staff = await ctxPage(browser, "tsk.staff@hashi.test");
  await staff.goto("/records");
  await expect(staff.locator(`[data-record-id="${recordId}"]`).getByTestId("badge-updated")).toHaveText("Diperbarui sejak kamu baca");
  await staff.goto(`/records/${recordId}`);
  await expect(staff.getByTestId("reader").filter({ hasText: "Diperbarui sejak kamu baca" })).toBeVisible();
  await staff.context().close();
});

test("kasus: buat kasus, notulen ② dengan baris kronologi dari form, ① -> kronologi, kasus dari catatan", async ({ browser }) => {
  const admin = await ctxPage(browser, "tsk.admin@hashi.test");
  await admin.goto("/records/cases/new");
  await admin.locator("#title").fill(`寮のトラブル${run}`);
  await admin.getByTestId(`worker-${worker.id}`).check();
  await admin.getByTestId("case-form").locator("button[type=submit]").click();
  await admin.waitForURL(/\/records\/cases\/[0-9a-f-]{36}$/);
  caseId = admin.url().split("/").pop()!;
  await expect(admin.getByTestId("case-code")).toHaveText(/^K-\d{4}-\d{4}$/);
  await expect(admin.getByTestId("case-status")).toContainText(/未完了|対応中|Terbuka/);

  // ② dengan baris kronologi
  await admin.goto(`/records/new?kind=meeting&case=${caseId}`);
  await admin.locator("#meetingSubject").fill(`打合せ${run}`);
  await admin.getByTestId("add-point-consultation").click();
  await admin.locator("#consultation-0").fill(`相談内容${run}`);
  await expect(admin.getByTestId("timeline-editor")).toBeVisible();
  await admin.getByTestId("add-timeline-row").click();
  await admin.getByTestId("tl-event").fill(`出来事${run}`);
  await admin.getByTestId("save-record").click();
  await admin.waitForURL(UUID_URL);
  await expect(admin.getByTestId("meeting-sections")).toContainText(`相談内容${run}`);
  await admin.goto(`/records/cases/${caseId}`);
  await expect(admin.getByTestId("timeline-row").filter({ hasText: `出来事${run}` })).toHaveCount(1);
  await expect(admin.getByTestId("related-records")).toContainText(`打合せ${run}`);
  await admin.context().close();

  // ① -> kronologi (oleh staf)
  const staff = await ctxPage(browser, "tsk.staff@hashi.test");
  const rid = await createDaily(staff, `対応${run}`);
  await staff.locator("#tl-case").selectOption(caseId);
  await staff.getByTestId("to-timeline-form").locator("button[type=submit]").click();
  await staff.waitForURL(/\/records\/cases\/[0-9a-f-]{36}$/);
  await expect(staff.getByTestId("timeline-row").filter({ hasText: `対応${run}` })).toHaveCount(1);
  await expect(staff.getByTestId("timeline-row").filter({ hasText: `対応${run}` }).locator(`a[href="/records/${rid}"]`)).toHaveCount(1);
  // kasus baru dari catatan
  const rid2 = await createDaily(staff, `別の対応${run}`);
  await staff.getByTestId("create-case-form").locator("button[type=submit]").click();
  await staff.waitForURL(/\/records\/cases\/[0-9a-f-]{36}$/);
  await expect(staff.getByTestId("case-title")).toHaveText(`別の対応${run}`);
  await expect(staff.getByTestId("related-records")).toBeVisible();
  void rid2;
  await staff.context().close();
});

test("tugas tindak lanjut: dibuat dari catatan, lewat tenggat bertanda teks, muncul di tab Tindak lanjut, diselesaikan", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  const rid = await createDaily(page, `課題元${run}`);
  await page.getByTestId("add-followup-toggle").click();
  await page.locator("#fu-desc").fill(`確認する${run}`);
  await page.locator("#fu-due").fill("2020-01-01");
  await page.getByTestId("add-followup-form").locator("button[type=submit]").click();
  const item = page.getByTestId("followup-item").filter({ hasText: `確認する${run}` });
  await expect(item).toBeVisible();
  await expect(item.getByTestId("badge-overdue")).toContainText("Lewat tenggat"); // teks, bukan hanya warna
  await page.goto("/records/tasks?scope=mine&status=overdue");
  const listed = page.getByTestId("followup-item").filter({ hasText: `確認する${run}` });
  await expect(listed).toBeVisible();
  await listed.getByTestId("followup-done").locator("button[type=submit]").click();
  await expect(page.getByTestId("followup-item").filter({ hasText: `確認する${run}` })).toHaveCount(0); // tidak lagi terbuka
  await page.goto("/records/tasks?scope=mine&status=done");
  await expect(page.getByTestId("followup-item").filter({ hasText: `確認する${run}` })).toHaveAttribute("data-status", "done");
  void rid;
  await page.context().close();
});

test("validasi foto: bukan gambar ditolak, HEIC ditolak dengan pesan khusus, PNG diterima", async ({ browser }) => {
  const page = await ctxPage(browser, "tsk.staff@hashi.test");
  const rid = await createDaily(page, `foto${run}`);
  const form = page.getByTestId("upload-attachment-form");
  await page.getByTestId("attachment-file").setInputFiles({ name: "palsu.png", mimeType: "image/png", buffer: Buffer.from("%PDF-1.4 ini bukan gambar") });
  await form.locator("button[type=submit]").click();
  await expect(form.getByTestId("form-error")).toHaveText("Hanya foto JPG, PNG, atau WebP.");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
  await page.getByTestId("attachment-file").setInputFiles({ name: "iphone.heic", mimeType: "image/heic", buffer: heic });
  await form.locator("button[type=submit]").click();
  await expect(form.getByTestId("form-error")).toContainText("HEIC");
  expect(Number((await ownerQuery<{ n: string }>("select count(*) as n from activity_attachments where record_id = $1", [rid]))[0].n)).toBe(0);
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#fff" } }).png().toBuffer();
  await page.getByTestId("attachment-file").setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: png });
  await form.locator("button[type=submit]").click();
  await expect(page.getByTestId("attachment-item")).toHaveCount(1);
  // sembunyikan: baris tetap ada di database (tidak ada hapus), hanya removed_at yang terisi
  await page.getByTestId("remove-attachment").locator("button[type=submit]").click();
  await expect(page.getByTestId("attachment-item")).toHaveCount(0);
  const [a] = await ownerQuery<{ removed_at: string | null }>("select removed_at from activity_attachments where record_id = $1", [rid]);
  expect(a.removed_at).not.toBeNull();
  await page.context().close();
});

test("laporan harian: staf mengirim ke leader, leader membaca, ① ditambah setelah kirim bertanda, kirim ulang", async ({ browser }) => {
  const staff2 = await ctxPage(browser, "tsk.staff2@hashi.test");
  const rid = await createDaily(staff2, `日報${run}`);
  await staff2.goto("/records");
  await expect(staff2.getByTestId("report-count")).toContainText(/\d/);
  await staff2.getByTestId("report-send-toggle").click();
  await staff2.getByTestId("share-report-form").locator("button[type=submit]").click();
  await expect(staff2.getByTestId("report-state")).toContainText(/送信済み|Terkirim/);
  await expect(staff2.getByTestId("report-recipients")).toContainText("田中 一郎");
  const [rep] = await ownerQuery<{ id: string; shared_at: string }>("select id::text, shared_at::text from activity_daily_reports where author_id = (select id from users where email = 'tsk.staff2@hashi.test') order by report_date desc limit 1");

  // leader (admin) membaca
  const admin = await ctxPage(browser, "tsk.admin@hashi.test");
  await admin.goto("/records/reports");
  const card = admin.locator(`[data-testid=staff-report][data-author]`).filter({ hasText: "佐藤 美香" }).first();
  await expect(card).toBeVisible();
  await card.getByTestId("mark-report-read").locator("button[type=submit]").click();
  await expect(card.getByTestId("report-unread")).toHaveCount(0);

  // ① baru SESUDAH dikirim -> bertanda di kartu pengirim dan "diperbarui sejak dibaca" di sisi leader
  await createDaily(staff2, `日報追加${run}`);
  await staff2.goto("/records");
  await expect(staff2.getByTestId("report-added-after")).toBeVisible();
  await admin.goto("/records/reports");
  await expect(admin.locator(`[data-testid=staff-report]`).filter({ hasText: "佐藤 美香" }).first().getByTestId("report-updated")).toBeVisible();
  // kirim ulang
  await staff2.getByTestId("report-send-toggle").click();
  await staff2.getByTestId("share-report-form").locator("button[type=submit]").click();
  await expect(staff2.getByTestId("report-added-after")).toHaveCount(0); // setelah kirim ulang, penanda dihitung dari waktu kirim yang baru
  const [rep2] = await ownerQuery<{ shared_at: string }>("select shared_at::text from activity_daily_reports where id = $1", [rep.id]);
  await expect.poll(async () => (await ownerQuery<{ shared_at: string }>("select shared_at::text from activity_daily_reports where id = $1", [rep.id]))[0].shared_at).not.toBe(rep.shared_at);
  void rep2; void rid;
  await admin.context().close();
  await staff2.context().close();
});

test("audit: aksi tercatat di log organisasi TSK saja, tanpa isi/nama pekerja/nama berkas; 'sudah dibaca' tidak dicatat; LPK tidak melihatnya", async ({ browser }) => {
  const rows = await ownerQuery<{ action: string; organization_id: string; actor_org_id: string; candidate_id: string | null; entity: string; before: unknown; after: unknown }>(
    "select action, organization_id::text, actor_org_id::text, candidate_id::text, entity, before, after from audit_logs where created_at >= $1 and (action like 'activity\\_%' or action like 'case\\_timeline\\_%' or action like 'periodic\\_%')", [startedAt]);
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ["activity_record.create", "activity_record.update", "activity_attachment.add", "activity_case.create", "case_timeline_event.create", "activity_followup.create", "activity_followup.status_change", "activity_daily_report.share"]) expect(actions.has(a), a).toBe(true);
  const [tskOrg] = await ownerQuery<{ id: string }>("select id::text from organizations where name = 'TSK Demo Tokyo'");
  expect(rows.every((r) => r.organization_id === tskOrg.id && r.actor_org_id === tskOrg.id && r.candidate_id === null)).toBe(true);
  const dump = JSON.stringify(rows);
  for (const secret of [MARK1, MARK2, run, worker.name, "gps.jpg", "ok.png", "現場の写真"]) expect(dump).not.toContain(secret);
  expect([...actions].some((a) => /read/i.test(a))).toBe(false);

  const lpk = await ctxPage(browser, "lpk1.admin@hashi.test");
  await lpk.goto("/activity?category=records");
  await expect(lpk.getByTestId("audit-total")).toHaveText("0");
  await lpk.goto("/activity");
  expect(await lpk.content()).not.toContain("activity_record");
  await lpk.context().close();
  const admin = await ctxPage(browser, "tsk.admin@hashi.test");
  await admin.goto("/activity?category=records");
  expect(Number(await admin.getByTestId("audit-total").textContent())).toBeGreaterThan(5);
  await expect(admin.getByTestId("audit-row").first().getByTestId("audit-text")).not.toHaveText(/^[a-z_]+\.[a-z_]+$/); // kalimat manusiawi
  await admin.context().close();
});

test("pembatalan: alasan wajib, catatan tetap terlihat (dicoret) dengan alasan, tidak bisa diubah lagi", async ({ browser }) => {
  const admin = await ctxPage(browser, "tsk.admin@hashi.test");
  await admin.goto(`/records/${recordId}`);
  await admin.getByTestId("record-actions").locator("summary").click();
  const form = admin.getByTestId("void-form");
  const textarea = form.locator("#void-reason");
  expect(await textarea.evaluate((el) => (el as HTMLTextAreaElement).required)).toBe(true); // alasan wajib
  await textarea.fill(`入力ミス${run}`);
  await form.locator("button[type=submit]").click();
  await expect(admin.getByTestId("badge-void")).toBeVisible();
  await expect(admin.getByTestId("void-reason")).toContainText(`入力ミス${run}`);
  await expect(admin.getByTestId("edit-record")).toHaveCount(0);
  expect((await admin.goto(`/records/${recordId}/edit`))?.status()).toBe(404);
  await admin.goto("/records");
  const row = admin.locator(`[data-record-id="${recordId}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByText("Dibatalkan").or(row.getByText("取消済み"))).toBeVisible();
  const [r] = await ownerQuery<{ status: string; void_reason: string; voided_by: string | null }>("select status, void_reason, voided_by::text from activity_records where id = $1", [recordId]);
  expect(r).toMatchObject({ status: "void", void_reason: `入力ミス${run}` });
  expect(r.voided_by).not.toBeNull();
  await admin.context().close();
});
