import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Bagian "在留カード" di halaman pekerja (T-018): alur lengkap oleh 担当, baca-saja untuk staf lain, penolakan server, audit tanpa isi, LPK/sensei 404, ponsel, bahasa Jepang.
// Memakai pekerja uji SENDIRI (kandidat + penempatan aktif) supaya data seed tidak tersentuh; semua dibersihkan di afterAll.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date().toISOString();
const NOTE = `Menunggu salinan kontrak ${run}`;
const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let worker = { id: "", name: "" };
let ids = { staffA: "", staffB: "", tsk: "", site: "" };

test.beforeAll(async () => {
  const [u] = await ownerQuery<{ a: string; b: string; tsk: string }>("select (select id::text from users where email = 'tsk.staff@hashi.test') as a, (select id::text from users where email = 'tsk.staff2@hashi.test') as b, (select id::text from organizations where name = 'TSK Demo Tokyo') as tsk");
  const [site] = await ownerQuery<{ id: string }>("select s.id::text as id from client_sites s join organizations o on o.id = s.org_id where o.name = 'TSK Demo Tokyo' order by s.id limit 1");
  ids = { staffA: u.a, staffB: u.b, tsk: u.tsk, site: site.id };
  const name = `Uji Kartu ${run}`;
  const [c] = await ownerQuery<{ id: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
     select o.id, $1, 'MALE', '2000-05-15', (select id from skill_fields where code = 'food'), 'READY', true from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id`, [name]);
  worker = { id: c.id, name };
  const [p] = await ownerQuery<{ id: string }>("insert into placements (candidate_id, org_id, site_id, start_date, status) values ($1, $2, $3, current_date - 90, 'ACTIVE') returning id::text as id", [worker.id, ids.tsk, ids.site]);
  await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $2, current_date, clock_timestamp())", [ids.tsk, ids.staffA, p.id]);
});

test.afterAll(async () => {
  await ownerQuery("delete from residence_cards where candidate_id = $1", [worker.id]);
  await ownerQuery("delete from responsible_assignments where created_at >= $1", [startedAt]);
  await ownerQuery("delete from candidates where id = $1", [worker.id]); // penempatan ikut terhapus (cascade)
});

async function pageFor(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await login(page, email);
  return page;
}
const url = () => `/records/workers/${worker.id}`;
const section = (p: Page) => p.getByTestId("card-section");
const current = (p: Page) => p.getByTestId("card-current");
const dbCards = () => ownerQuery<{ id: string; renewal_status: string; expiry_date: string; previous_card_id: string | null; received_by: string | null; handed_over_on: string | null; status: string; period_months: number | null; note: string | null }>(
  "select id::text, renewal_status, expiry_date::text, previous_card_id::text, received_by, handed_over_on::text, status, period_months, note from residence_cards where candidate_id = $1 order by created_at", [worker.id]);
/** Buka <details> bila belum terbuka (setelah simpan, router.refresh mempertahankan keadaan terbuka). */
async function ensureOpen(p: Page, toggleTestId: string) {
  const details = p.locator(`details:has([data-testid=${toggleTestId}])`).first();
  if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open))) await p.getByTestId(toggleTestId).click();
}
async function openEdit(p: Page) {
  await ensureOpen(p, "card-edit-toggle");
  return p.getByTestId("card-update-form");
}
async function updateStatus(p: Page, status: string, fill: Record<string, string> = {}) {
  const f = await openEdit(p);
  await f.getByTestId("u-status").selectOption(status);
  for (const [tid, v] of Object.entries(fill)) await f.getByTestId(tid).fill(v);
  await f.locator("button[type=submit]").click();
}

test("担当: catat kartu pertama (bidang bawaan dari kandidat, 在留期間, tanggal habis) → tahap dan sisa hari tampil", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test"); // UI Indonesia
  await page.goto(url());
  await expect(section(page)).toHaveAttribute("data-can-edit", "true");
  await expect(page.getByTestId("card-empty")).toBeVisible();
  const f = page.getByTestId("card-create-form");
  await expect(f.locator("#c-field option:checked")).toContainText("Pengolahan makanan"); // bawaan dari bidang kandidat
  await f.getByTestId("c-period").selectOption("12");
  await f.getByTestId("c-expiry").fill(d(80));
  await f.locator("button[type=submit]").click();
  await expect(current(page)).toBeVisible();
  await expect(current(page)).toHaveAttribute("data-stage", "can_apply"); // 80 hari = kurang dari 3 bulan
  await expect(current(page)).toHaveAttribute("data-renewal", "not_started");
  await expect(page.getByTestId("card-days")).toContainText("hari lagi");
  expect((await dbCards())).toHaveLength(1);
  expect((await dbCards())[0].period_months).toBe(12);
  await expect(page.getByTestId("card-create-form")).toHaveCount(0); // sudah punya kartu
  await page.context().close();
});

test("persiapan → diajukan: tahap menjadi 'Menunggu hasil' (結果待ち) dan tidak naik lagi; tanggal pengajuan wajib", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  await updateStatus(page, "preparing");
  await expect(page.getByTestId("card-renewal")).toContainText("Persiapan berkas");
  await expect(current(page)).toHaveAttribute("data-stage", "can_apply");
  // diajukan tanpa tanggal: ditolak peramban (required); isi tanggal
  const f = await openEdit(page);
  await f.getByTestId("u-status").selectOption("applied");
  await expect(f.getByTestId("u-applied")).toBeVisible();
  await expect(f.getByTestId("u-applied")).toHaveAttribute("required", "");
  await f.getByTestId("u-applied").fill(d(-2));
  await f.locator("button[type=submit]").click();
  await expect(current(page)).toHaveAttribute("data-renewal", "applied");
  await expect(current(page)).toHaveAttribute("data-stage", "waiting_result");
  await expect(page.getByTestId("card-stage")).toContainText("Menunggu hasil");
  await page.context().close();
});

test("追加資料: tanggal diminta wajib, tanda tampil, tahap tetap 'menunggu hasil'; catatan dengan nomor kartu ditolak", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  const f = await openEdit(page);
  await f.getByTestId("u-status").selectOption("additional_docs");
  await expect(f.getByTestId("u-docs")).toHaveAttribute("required", "");
  await f.getByTestId("u-docs").fill(d(-1));
  await f.getByTestId("u-note").fill("Nomor AB12345678CD");
  await f.locator("button[type=submit]").click();
  await expect(page.getByTestId("form-error")).toContainText("nomor kartu");
  await f.getByTestId("u-note").fill(NOTE);
  await f.locator("button[type=submit]").click();
  await expect(page.getByTestId("card-additional")).toBeVisible();
  await expect(current(page)).toHaveAttribute("data-renewal", "additional_docs");
  await expect(current(page)).toHaveAttribute("data-stage", "waiting_result");
  await expect(page.getByTestId("card-note")).toContainText(NOTE);
  await page.context().close();
});

test("不許可: tanggal ditolak wajib → tahap 'ditolak' (perhatian); bisa diajukan lagi", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  const f = await openEdit(page);
  await f.getByTestId("u-status").selectOption("rejected");
  await expect(f.getByTestId("u-rejected")).toHaveAttribute("required", "");
  await f.getByTestId("u-rejected").fill(d(-1));
  await f.locator("button[type=submit]").click();
  await expect(current(page)).toHaveAttribute("data-stage", "rejected");
  await expect(page.getByTestId("card-stage")).toContainText("ditolak");
  await expect(page.getByTestId("card-receive-toggle")).toHaveCount(0); // ditolak: tidak bisa "terima kartu baru"
  await updateStatus(page, "applied");
  await expect(current(page)).toHaveAttribute("data-stage", "waiting_result");
  await page.context().close();
});

test("terima kartu baru oleh staf (SATU transaksi: kartu lama diterima + kartu baru) lalu diserahkan ke pekerja", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  await ensureOpen(page, "card-receive-toggle");
  const f = page.getByTestId("card-receive-form");
  await f.getByTestId("r-on").fill(d(-1));
  await f.getByTestId("r-by").selectOption("staff");
  await f.getByTestId("r-expiry").fill(d(80 + 365));
  await f.locator("button[type=submit]").click();
  await expect(page.getByTestId("card-history-item")).toHaveCount(2);
  const [oldCard, newCard] = await dbCards();
  expect(oldCard.renewal_status).toBe("received");
  expect(oldCard.received_by).toBe("staff");
  expect(oldCard.handed_over_on).toBeNull();
  expect(newCard.previous_card_id).toBe(oldCard.id);
  expect(newCard.renewal_status).toBe("not_started");
  await expect(current(page)).toHaveAttribute("data-card-id", newCard.id);
  await expect(page.locator(`[data-testid=card-history-item][data-card-id="${oldCard.id}"]`).getByTestId("card-history-received")).toContainText("belum diserahkan");
  // diserahkan ke pekerja
  const item = page.locator(`[data-testid=card-history-item][data-card-id="${oldCard.id}"]`);
  await item.getByTestId("card-handover-toggle").click();
  await item.getByTestId("h-on").fill(d(0));
  await item.getByTestId("card-handover-form").locator("button[type=submit]").click();
  await expect(item.getByTestId("card-history-received")).not.toContainText("belum diserahkan"); // "belum diserahkan ke pekerja" juga memuat kata "diserahkan"
  await expect.poll(async () => (await dbCards())[0].handed_over_on, { timeout: 10000 }).not.toBeNull();
  await expect(item.getByTestId("card-handover-toggle")).toHaveCount(0);
  await page.context().close();
});

test("audit: tercatat create/update/receive; isi hanya kode status/tahap dan NAMA kolom (tanpa tanggal, catatan, nama)", async () => {
  const rows = await ownerQuery<{ action: string; after: Record<string, unknown> | null }>("select action, after from audit_logs where entity = 'residence_card' and created_at >= $1 order by id", [startedAt]);
  const actions = rows.map((r) => r.action);
  for (const a of ["residence_card.create", "residence_card.update", "residence_card.receive"]) expect(actions).toContain(a);
  const json = JSON.stringify(rows);
  expect(json).not.toContain(NOTE);
  expect(json).not.toContain(worker.name);
  expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/); // tidak ada tanggal
  const allowed = new Set(["residenceStatus", "renewalStatus", "stage", "receivedBy", "status", "fields"]);
  for (const r of rows) for (const k of Object.keys(r.after ?? {})) expect(allowed.has(k), `${r.action}:${k}`).toBe(true);
  expect(rows.find((r) => r.action === "residence_card.receive")?.after).toMatchObject({ renewalStatus: "received", receivedBy: "staff", stage: "done" });
});

test("staf BUKAN 担当: baca-saja dengan penjelasan siapa yang boleh mengubah; Admin tetap bisa mengubah", async ({ browser }) => {
  const other = await pageFor(browser, "tsk.staff2@hashi.test");
  await other.goto(url());
  await expect(section(other)).toHaveAttribute("data-can-edit", "false");
  await expect(other.getByTestId("card-readonly")).toContainText("Rina Staf TSK"); // 担当
  await expect(other.getByTestId("card-readonly")).toContainText(/Admin TSK|管理者/); // tsk.staff2 memakai UI Jepang
  await expect(other.getByTestId("card-actions")).toHaveCount(0);
  await expect(other.getByTestId("card-edit-toggle")).toHaveCount(0);
  await expect(other.getByTestId("card-history-item")).toHaveCount(2); // tetap melihat riwayat
  await other.context().close();
  const admin = await pageFor(browser, "tsk.admin@hashi.test");
  await admin.goto(url());
  await expect(section(admin)).toHaveAttribute("data-can-edit", "true");
  await expect(admin.getByTestId("card-edit-toggle")).toBeVisible();
  await admin.context().close();
});

test("LPK_ADMIN dan sensei: halaman pekerja (dan data kartunya) = 404", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test"]) {
    const page = await pageFor(browser, email);
    expect((await page.goto(url()))?.status(), email).toBe(404);
    await page.context().close();
  }
});

test("bahasa Jepang (Admin TSK): judul, tahap, dan status dalam bahasa Jepang; ponsel 390 px tanpa gulir horizontal", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test");
  await page.goto(url());
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(section(page)).toContainText("在留カード");
  await expect(page.getByTestId("card-stage")).toContainText(/(準備開始|申請が可能|対応不要|期限)/);
  await expect(page.getByTestId("card-renewal")).toContainText("未着手");
  await page.context().close();
  const phone = await pageFor(browser, "tsk.staff@hashi.test", { width: 390, height: 844 });
  await phone.goto(url());
  await expect(section(phone)).toBeVisible();
  await phone.getByTestId("card-edit-toggle").click();
  await phone.waitForLoadState("networkidle");
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await phone.context().close();
});

test("server menolak: form lama dibiarkan terbuka lalu 担当 diganti → simpan ditolak dengan pesan jelas, data tidak berubah; batalkan dengan alasan", async ({ browser }) => {
  const stale = await pageFor(browser, "tsk.staff@hashi.test");
  await stale.goto(url());
  const f = await openEdit(stale);
  await f.getByTestId("u-note").fill("catatan setelah diganti");
  // 担当 diganti ke staf lain saat form masih terbuka (oleh Admin, lewat DB)
  const [pl] = await ownerQuery<{ id: string }>("select id::text from placements where candidate_id = $1 and status = 'ACTIVE'", [worker.id]);
  await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $4, current_date, clock_timestamp())", [ids.tsk, ids.staffA, pl.id, ids.staffB]);
  await f.locator("button[type=submit]").click();
  await expect(stale.getByTestId("form-error")).toContainText("bukan penanggung jawab");
  const before = await dbCards();
  expect(before[1].note ?? "").not.toContain("setelah diganti");
  await stale.context().close();
  // sekarang staf B = 担当: boleh; membatalkan kartu baru (belum punya pengganti, bukan pengganti dari kartu diterima?) → kartu baru adalah pengganti: ditolak dengan pesan jelas
  const b = await pageFor(browser, "tsk.staff2@hashi.test");
  await b.goto(url());
  await expect(section(b)).toHaveAttribute("data-can-edit", "true");
  await b.getByTestId("card-void-toggle").click();
  await b.getByTestId("v-reason").fill("salah input");
  await b.getByTestId("card-void-form").locator("button[type=submit]").click();
  await expect(b.getByTestId("form-error")).toContainText(/tidak bisa dibatalkan|取り消せません/); // UI Jepang
  expect((await dbCards())[1].status).toBe("active");
  await b.context().close();
});
