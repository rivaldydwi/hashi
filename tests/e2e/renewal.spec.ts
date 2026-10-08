import { expect, test, type Browser, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { login, ownerQuery, unique } from "./helpers";

// Data perpanjangan 在留カード online (T-021): butir 1-14 siap salin, data Jepang pekerja, nomor kartu hanya lewat aksi diaudit, 404 untuk non-担当/LPK/sensei, peringatan paspor,
// alasan bisa diubah tanpa disimpan, tautan dari daftar kartu. Pekerja uji SENDIRI; dibersihkan di afterAll.

test.describe.configure({ mode: "serial" });

const run = unique();
const tag = run.replace(/\d/g, (c) => "ABCDEFGHIJ"[Number(c)]); // nama romaji hanya huruf: angka unik diganti huruf
const startedAt = new Date().toISOString();
const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const NUMBER = "CD87654321EF";
const ADDRESS_JP = `東京都新宿区西新宿1-2-3 ${run}`;
const PHONE_JP = "090-1234-5678";
let worker = { id: "", name: "" };
let ids = { staffA: "", tsk: "", site: "", card: "" };

test.beforeAll(async () => {
  const [u] = await ownerQuery<{ a: string; tsk: string }>("select (select id::text from users where email = 'tsk.staff@hashi.test') as a, (select organization_id::text from users where email = 'tsk.staff@hashi.test') as tsk");
  const [site] = await ownerQuery<{ id: string }>("select s.id::text as id from client_sites s join organizations o on o.id = s.org_id where o.name = 'TSK Demo Tokyo' order by s.id limit 1");
  ids = { ...ids, staffA: u.a, tsk: u.tsk, site: site.id };
  const name = `Dewi Lestari ${tag}`;
  const [c] = await ownerQuery<{ id: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, marital_status, field_id, stage, shared_with_tsk)
     select o.id, $1, 'FEMALE', '1999-03-04', 'MARRIED', (select id from skill_fields where code = 'food'), 'READY', true from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id`, [name]);
  worker = { id: c.id, name };
  await ownerQuery("insert into candidate_private (candidate_id, address, passport_number, passport_expiry_date) values ($1, 'Jl. Melati 5, Bandung, Jawa Barat', 'C7654321', $2::date)", [worker.id, d(900)]);
  const [p] = await ownerQuery<{ id: string }>("insert into placements (candidate_id, org_id, site_id, start_date, status) values ($1, $2, $3, current_date - 90, 'ACTIVE') returning id::text as id", [worker.id, ids.tsk, ids.site]);
  await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $2, current_date, clock_timestamp())", [ids.tsk, ids.staffA, p.id]);
  const [card] = await ownerQuery<{ id: string }>("insert into residence_cards (organization_id, created_by, candidate_id, skill_field_id, expiry_date, period_months) values ($1, $2, $3, (select id from skill_fields where code = 'food'), $4::date, 12) returning id::text as id", [ids.tsk, ids.staffA, worker.id, d(100)]);
  ids.card = card.id;
});

test.afterAll(async () => {
  await ownerQuery("delete from residence_card_secrets where candidate_id = $1", [worker.id]);
  await ownerQuery("delete from residence_cards where candidate_id = $1", [worker.id]);
  await ownerQuery("delete from worker_jp_profiles where candidate_id = $1", [worker.id]);
  await ownerQuery("delete from responsible_assignments where created_at >= $1", [startedAt]);
  await ownerQuery("delete from candidates where id = $1", [worker.id]);
});

async function pageFor(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await login(page, email);
  return page;
}
const url = () => `/records/workers/${worker.id}/renewal`;
const item = (p: Page, no: number) => p.locator(`[data-testid=renewal-item][data-no="${no}"]`);
const audits = (action: string) => ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where action = $1 and created_at >= $2 and (entity_id = $3 or entity_id = $4)", [action, startedAt, ids.card, worker.id]).then((r) => r[0].n);
const clip = (p: Page) => p.evaluate(() => navigator.clipboard.readText());

test("担当: butir 1-14 + pengingat 15/16, nilai dari profil (kapital, 西暦 + 和暦), butir kosong ditandai dengan tautan perbaikan", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  await expect(page.getByTestId("renewal-item")).toHaveCount(16);
  await expect(page.getByTestId("renewal-title")).toContainText(worker.name);
  expect(await page.getByTestId("renewal-title").locator('[translate="no"]').count()).toBeGreaterThan(0); // nama = data
  await expect(item(page, 1)).toContainText("インドネシア");
  await expect(item(page, 2)).toContainText("1999/03/04");
  await expect(item(page, 2)).toContainText("平成11年3月4日");
  await expect(item(page, 3)).toContainText(`DEWI LESTARI ${tag}`);
  await expect(item(page, 3)).toContainText("FAMILY");
  await expect(item(page, 4)).toContainText("女");
  await expect(item(page, 5)).toContainText("有"); // menikah
  await expect(item(page, 6)).toContainText("会社員");
  await expect(item(page, 7)).toContainText("Jl. Melati 5, Bandung");
  await expect(item(page, 10)).toContainText("C7654321");
  await expect(item(page, 11)).toContainText("特定技能1号");
  await expect(item(page, 11)).toContainText("1年");
  await expect(item(page, 13)).toContainText("1年");
  await expect(item(page, 14).getByTestId("renewal-reason")).toHaveValue(/特定技能1号の在留資格で/);
  // data Jepang + nomor kartu belum ada → ditandai kosong dengan tautan
  for (const no of [8, 9, 12]) await expect(item(page, no)).toHaveAttribute("data-missing", "true");
  await expect(item(page, 8).getByTestId("renewal-fix")).toHaveAttribute("href", `/records/workers/${worker.id}#jp-profile`);
  await expect(page.getByTestId("renewal-missing-summary")).toHaveAttribute("data-missing", "3");
  await expect(item(page, 15)).toContainText("Tidak disimpan di Hashi");
  await page.context().close();
});

test("data Jepang diisi di halaman pekerja (担当), tersimpan, audit hanya NAMA kolom; halaman perpanjangan memakainya dan tombol Salin menyalin nilainya", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/workers/${worker.id}`);
  await expect(page.getByTestId("jp-profile")).toHaveAttribute("data-can-edit", "true");
  await page.getByTestId("jp-edit-toggle").click();
  await page.getByTestId("jp-address").fill(ADDRESS_JP);
  await page.getByTestId("jp-phone").fill("tel-salah");
  await page.getByTestId("jp-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("form-error").first()).toBeVisible(); // telepon tidak sah
  await page.getByTestId("jp-phone").fill(PHONE_JP);
  await page.getByTestId("jp-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("jp-address-value")).toHaveText(ADDRESS_JP);
  await expect(page.getByTestId("jp-address-value")).toHaveAttribute("translate", "no");
  const log = await ownerQuery<{ after: Record<string, unknown> }>("select after from audit_logs where action = 'worker_jp_profile.update' and entity_id = $1 and created_at >= $2", [worker.id, startedAt]);
  expect(log).toHaveLength(1);
  expect(log[0].after).toEqual({ fields: ["addressJp", "phoneJp"] });
  expect(JSON.stringify(log)).not.toContain("新宿");

  await page.goto(url());
  await expect(item(page, 8)).toContainText(ADDRESS_JP);
  await expect(item(page, 9)).toContainText(PHONE_JP);
  await expect(page.getByTestId("renewal-missing-summary")).toHaveAttribute("data-missing", "1"); // tinggal nomor kartu
  await item(page, 8).getByRole("button", { name: /Salin/ }).click();
  expect(await clip(page)).toBe(ADDRESS_JP);
  await expect(item(page, 8).locator("[data-copied=true]")).toHaveCount(1);
  await item(page, 10).locator("li").first().getByRole("button").click();
  expect(await clip(page)).toBe("C7654321");
  await page.context().close();
});

test("nomor kartu (butir 12): tidak ada di HTML; muncul hanya lewat Tampilkan (diaudit), bisa disalin", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/workers/${worker.id}`);
  await page.getByTestId("card-number-edit-toggle").click();
  await page.getByTestId("card-number-input").fill(NUMBER);
  await page.getByTestId("card-number-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("card-number-masked")).toBeVisible();

  const before = await audits("residence_card.number_view");
  await page.goto(url());
  expect(await page.content()).not.toContain(NUMBER);
  await expect(item(page, 12)).toHaveAttribute("data-missing", "false");
  await expect(page.getByTestId("renewal-missing-summary")).toHaveText("Semua butir sudah terisi.");
  expect(await audits("residence_card.number_view")).toBe(before); // membuka halaman TIDAK menampilkan nomor
  await item(page, 12).getByTestId("card-number-show").click();
  await expect(item(page, 12).getByTestId("card-number-value")).toHaveText(NUMBER);
  expect(await audits("residence_card.number_view")).toBe(before + 1);
  await item(page, 12).getByTestId("card-number-copy").click();
  expect(await clip(page)).toBe(NUMBER);
  const leaks = await ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where created_at >= $1 and (coalesce(before::text, '') || coalesce(after::text, '')) like '%87654321%'", [startedAt]);
  expect(leaks[0].n).toBe(0);
  await page.context().close();
});

test("alasan perpanjangan (14) bisa diubah dan disalin tetapi TIDAK disimpan; paspor habis sebelum 満了日 = peringatan", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  const box = item(page, 14).getByTestId("renewal-reason");
  const original = await box.inputValue();
  await box.fill("手入力した理由");
  await item(page, 14).getByTestId("copy-reason").click();
  expect(await clip(page)).toBe("手入力した理由");
  await page.reload();
  await expect(item(page, 14).getByTestId("renewal-reason")).toHaveValue(original); // tidak tersimpan
  await expect(page.getByTestId("renewal-warnings")).toHaveCount(0);

  await ownerQuery("update candidate_private set passport_expiry_date = $2::date where candidate_id = $1", [worker.id, d(50)]); // sebelum 満了日 (+100)
  await page.reload();
  await expect(page.locator('[data-warning="passportBeforeCardExpiry"]')).toBeVisible();
  await ownerQuery("update candidate_private set passport_expiry_date = $2::date where candidate_id = $1", [worker.id, d(-3)]);
  await page.reload();
  await expect(page.locator('[data-warning="passportExpired"]')).toBeVisible();
  await page.context().close();
});

test("hak akses: staf lain, LPK, sensei = 404; Admin TSK boleh; tiap pembukaan oleh yang berhak dicatat (renewal_view)", async ({ browser }) => {
  for (const [email, status] of [["tsk.staff2@hashi.test", 404], ["lpk1.admin@hashi.test", 404], ["lpk1.sensei@hashi.test", 404], ["tsk.admin@hashi.test", 200]] as const) {
    const page = await pageFor(browser, email);
    expect((await page.request.get(url())).status(), email).toBe(status);
    await page.context().close();
  }
  const n = await audits("residence_card.renewal_view");
  expect(n).toBeGreaterThanOrEqual(5); // staf A (beberapa kali) + Admin
  const log = await ownerQuery<{ after: Record<string, unknown> | null }>("select after from audit_logs where action = 'residence_card.renewal_view' and entity_id = $1 and created_at >= $2", [ids.card, startedAt]);
  expect(JSON.stringify(log)).not.toMatch(/Dewi|Melati|87654321|C7654321/); // tanpa nilai
  // staf lain tidak melihat tautan di bagian kartu
  const other = await pageFor(browser, "tsk.staff2@hashi.test");
  await other.goto(`/records/workers/${worker.id}`);
  await expect(other.getByTestId("card-renewal-link")).toHaveCount(0);
  await expect(other.getByTestId("jp-readonly")).toBeVisible();
  await other.context().close();
});

test("tautan ke data perpanjangan: dari bagian kartu dan dari daftar kartu (tahap persiapan s.d. lewat tanggal habis) hanya untuk yang berhak", async ({ browser }) => {
  const a = await pageFor(browser, "tsk.staff@hashi.test");
  await a.goto(`/records/workers/${worker.id}`);
  await expect(a.getByTestId("card-renewal-link")).toHaveAttribute("href", url());
  await a.goto("/records/cards");
  const row = a.locator(`[data-testid=card-row][data-worker="${worker.id}"]`);
  await expect(row).toHaveAttribute("data-stage", /^(prepare|can_apply|h30|h14|h7|expired)$/);
  await expect(row.getByTestId("card-row-renewal")).toHaveAttribute("href", url());
  await a.context().close();
  const b = await pageFor(browser, "tsk.staff2@hashi.test");
  await b.goto("/records/cards");
  await expect(b.locator(`[data-testid=card-row][data-worker="${worker.id}"]`).getByTestId("card-row-renewal")).toHaveCount(0);
  await b.context().close();
});

test("tahap 結果待ち: daftar bawaan pengambilan kartu (pengajuan online: biaya online, tanpa materai) tampil sebagai teks bantuan", async ({ browser }) => {
  await ownerQuery("update residence_cards set renewal_status = 'applied', applied_on = current_date - 3 where id = $1", [ids.card]);
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/workers/${worker.id}`);
  const box = page.getByTestId("card-pickup-checklist");
  await expect(box).toBeVisible();
  await expect(box).toContainText("Paspor");
  await expect(box).toContainText("materai tidak berlaku untuk pengajuan online");
  await expect(box).toContainText("loket");
  await page.context().close();
});

test("手数料納付書 (T-026, hanya loket): tombol berlabel jelas; PDF resmi dengan nama romaji + nomor 2 dilingkari; diaudit tanpa nilai; staf lain/LPK/sensei 404", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  const sec = page.getByTestId("counter-section");
  await expect(sec).toContainText("HANYA untuk pengajuan di loket");
  await expect(sec).toContainText("tanpa formulir ini dan tanpa materai");
  const link = page.getByTestId("fee-form-link");
  await expect(link).toHaveAttribute("href", `/records/export/fee-form/${worker.id}`);
  await expect(link).toContainText("loket");
  const before = await ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where action = 'residence_card.fee_form_export' and created_at >= $1", [startedAt]);
  const res = await page.request.get(`/records/export/fee-form/${worker.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect(res.headers()["content-disposition"]).toContain("attachment");
  expect(res.headers()["content-disposition"]).toContain("tesuryo-nofusho-loket.pdf");
  expect(res.headers()["content-disposition"]).not.toContain(tag); // nama pekerja tidak masuk nama file
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  const dir = `${process.cwd()}/node_modules/pdfjs-dist`;
  const doc = await getDocument({ data: new Uint8Array(body), useSystemFonts: false, cMapUrl: `${dir}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${dir}/standard_fonts/` }).promise;
  expect(doc.numPages).toBe(1);
  const tc = await (await doc.getPage(1)).getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(text.replace(/\s+/g, "")).toContain("手数料納付書");
  expect(text).toContain(`DEWI LESTARI ${tag}`);
  const after = await ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where action = 'residence_card.fee_form_export' and created_at >= $1", [startedAt]);
  expect(after[0].n).toBe(before[0].n + 1);
  const leak = await ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where action = 'residence_card.fee_form_export' and created_at >= $1 and (coalesce(before::text, '') || coalesce(after::text, '')) ~* 'dewi|lestari'", [startedAt]);
  expect(leak[0].n).toBe(0);
  await page.context().close();

  for (const [email, status] of [["tsk.staff2@hashi.test", 404], ["lpk1.admin@hashi.test", 404], ["lpk1.sensei@hashi.test", 404], ["tsk.admin@hashi.test", 200]] as const) {
    const p = await pageFor(browser, email);
    expect((await p.request.get(`/records/export/fee-form/${worker.id}`)).status(), email).toBe(status);
    await p.context().close();
  }
});
