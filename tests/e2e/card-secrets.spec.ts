import { readFile, rm, stat } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Nomor dan foto 在留カード (T-020): terenkripsi, hanya 担当 + Admin, tersamar + "Tampilkan" (diaudit tanpa nilai), foto terenkripsi di disk dan diunduh lewat route handler,
// staf lain tidak melihat apa pun (UI dan server), kartu batal membuang nomor/foto. Pekerja uji SENDIRI; semua dibersihkan di afterAll.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date().toISOString();
const NUMBER = "AB12345678CD";
const MASKED = "AB********CD";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const STORAGE = process.env.E2E_STORAGE_DIR ?? `${process.cwd()}/.e2e-docs`;
let worker = { id: "", name: "" };
let ids = { staffA: "", staffB: "", tsk: "", site: "", card: "" };

test.beforeAll(async () => {
  const [u] = await ownerQuery<{ a: string; b: string; tsk: string }>("select (select id::text from users where email = 'tsk.staff@hashi.test') as a, (select id::text from users where email = 'tsk.staff2@hashi.test') as b, (select organization_id::text from users where email = 'tsk.staff@hashi.test') as tsk");
  const [site] = await ownerQuery<{ id: string }>("select s.id::text as id from client_sites s join organizations o on o.id = s.org_id where o.name = 'TSK Demo Tokyo' order by s.id limit 1");
  ids = { ...ids, staffA: u.a, staffB: u.b, tsk: u.tsk, site: site.id };
  const name = `Uji Rahasia Kartu ${run}`;
  const [c] = await ownerQuery<{ id: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
     select o.id, $1, 'MALE', '2000-05-15', (select id from skill_fields where code = 'food'), 'READY', true from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id`, [name]);
  worker = { id: c.id, name };
  const [p] = await ownerQuery<{ id: string }>("insert into placements (candidate_id, org_id, site_id, start_date, status) values ($1, $2, $3, current_date - 90, 'ACTIVE') returning id::text as id", [worker.id, ids.tsk, ids.site]);
  await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $2, current_date, clock_timestamp())", [ids.tsk, ids.staffA, p.id]);
  const [card] = await ownerQuery<{ id: string }>("insert into residence_cards (organization_id, created_by, candidate_id, skill_field_id, expiry_date) values ($1, $2, $3, (select id from skill_fields where code = 'food'), current_date + 200) returning id::text as id", [ids.tsk, ids.staffA, worker.id]);
  ids.card = card.id;
});

test.afterAll(async () => {
  await ownerQuery("delete from residence_card_secrets where candidate_id = $1", [worker.id]);
  const photos = await ownerQuery<{ id: string }>("select id::text from residence_card_photos where candidate_id = $1", [worker.id]);
  for (const p of photos) await rm(`${STORAGE}/cards/${ids.tsk}/${p.id}.enc`, { force: true });
  await ownerQuery("delete from residence_card_photos where candidate_id = $1", [worker.id]);
  await ownerQuery("delete from residence_cards where candidate_id = $1", [worker.id]);
  await ownerQuery("delete from responsible_assignments where created_at >= $1", [startedAt]);
  await ownerQuery("delete from candidates where id = $1", [worker.id]);
});

async function pageFor(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}
const url = () => `/records/workers/${worker.id}`;
const photoRows = () => ownerQuery<{ id: string; side: string; removed: boolean; mime: string }>("select id::text, side, mime, (removed_at is not null) as removed from residence_card_photos where card_id = $1 order by created_at", [ids.card]);
const audits = (action: string) => ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where action = $1 and entity_id = $2 and created_at >= $3", [action, ids.card, startedAt]).then((r) => r[0].n);
async function ensureOpen(p: Page, toggleTestId: string) {
  const details = p.locator(`details:has([data-testid=${toggleTestId}])`).first();
  if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open))) await p.getByTestId(toggleTestId).click();
}

test("担当: nomor ditolak bila format salah, disimpan terenkripsi, tampil tersamar; nomor asli tidak ada di HTML", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  await expect(page.getByTestId("card-secrets")).toBeVisible();
  await expect(page.getByTestId("card-number-none")).toBeVisible();
  await ensureOpen(page, "card-number-edit-toggle");
  await page.getByTestId("card-number-input").fill("XY123");
  await page.getByTestId("card-number-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("form-error").first()).toContainText("12 karakter");
  expect(await ownerQuery("select 1 from residence_card_secrets where card_id = $1", [ids.card])).toHaveLength(0);

  await page.getByTestId("card-number-input").fill("ab 12345678-cd");
  await page.getByTestId("card-number-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("card-number-masked")).toHaveText(MASKED);
  const html = await page.content();
  expect(html).not.toContain(NUMBER);
  expect(html).not.toContain("12345678");
  const [row] = await ownerQuery<{ number_enc: string; number_masked: string; key_id: string }>("select number_enc, number_masked, key_id from residence_card_secrets where card_id = $1", [ids.card]);
  expect(row.number_enc.startsWith("hcd1:")).toBe(true);
  expect(row.number_enc).not.toContain(NUMBER);
  expect(row.number_enc).not.toContain("12345678");
  expect(row.number_masked).toBe(MASKED);
  expect(row.key_id).toBe("k1");
  expect(await audits("residence_card.number_set")).toBe(1);
  await page.context().close();
});

test("'Tampilkan' menampilkan nomor lengkap dan mencatat audit TANPA nilai; seluruh audit sejak tes mulai tidak memuat nomor", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  await expect(page.getByTestId("card-number-masked")).toHaveText(MASKED);
  await page.getByTestId("card-number-show").click();
  await expect(page.getByTestId("card-number-value")).toHaveText(NUMBER);
  await expect(page.getByTestId("card-number-masked")).toHaveCount(0);
  expect(await audits("residence_card.number_view")).toBe(1);
  await page.getByTestId("card-number-hide").click();
  await expect(page.getByTestId("card-number-masked")).toBeVisible();
  const leaks = await ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where created_at >= $1 and (coalesce(before::text, '') || coalesce(after::text, '')) ~* '12345678'", [startedAt]);
  expect(leaks[0].n).toBe(0);
  await page.context().close();
});

test("foto: unggah ditolak bila bukan JPG/PNG/PDF; PNG disimpan terenkripsi (bukan PNG terbaca di disk) dan diunduh lewat route handler dengan audit", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  await ensureOpen(page, "card-photo-front-toggle");
  await page.getByTestId("card-photo-front-file").setInputFiles({ name: "catatan.txt", mimeType: "text/plain", buffer: Buffer.from("bukan gambar") });
  await page.getByTestId("card-photo-front-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("form-error").first()).toBeVisible();
  expect(await photoRows()).toHaveLength(0);

  await page.getByTestId("card-photo-front-file").setInputFiles({ name: "depan.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("card-photo-front-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("card-photo-front")).toHaveAttribute("data-has-photo", "true");
  const [photo] = await photoRows();
  expect(photo.side).toBe("front");
  expect(photo.mime).toBe("image/png");
  const onDisk = await readFile(`${STORAGE}/cards/${ids.tsk}/${photo.id}.enc`);
  expect(onDisk.subarray(0, 4).toString("ascii")).toBe("HCD1");
  expect(onDisk.subarray(0, 4).equals(PNG.subarray(0, 4))).toBe(false);
  expect(onDisk.includes(Buffer.from("IHDR"))).toBe(false); // isi PNG asli tidak terbaca di berkas

  const href = await page.getByTestId("card-photo-front-link").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["content-disposition"]).toContain("attachment");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect((await res.body()).subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(true); // hasil dekripsi = PNG sah
  expect(await audits("residence_card.photo_view")).toBe(1);
  await page.context().close();
});

test("mengganti foto: yang lama ditandai dihapus dan berkasnya dibuang; menghapus foto membuang berkas", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  const [first] = await photoRows();
  await ensureOpen(page, "card-photo-front-toggle");
  await page.getByTestId("card-photo-front-file").setInputFiles({ name: "depan2.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("card-photo-front-form").locator("button[type=submit]").click();
  await expect.poll(async () => (await photoRows()).length).toBe(2);
  const rows = await photoRows();
  expect(rows.find((r) => r.id === first.id)!.removed).toBe(true);
  await expect(stat(`${STORAGE}/cards/${ids.tsk}/${first.id}.enc`)).rejects.toThrow();
  const fresh = rows.find((r) => !r.removed)!;
  await expect(stat(`${STORAGE}/cards/${ids.tsk}/${fresh.id}.enc`)).resolves.toBeTruthy();

  await ensureOpen(page, "card-photo-back-toggle");
  await page.getByTestId("card-photo-back-file").setInputFiles({ name: "belakang.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("card-photo-back-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("card-photo-back")).toHaveAttribute("data-has-photo", "true");
  const back = (await photoRows()).find((r) => r.side === "back")!;
  await page.getByTestId("card-photo-back-remove").locator("button[type=submit]").click();
  await expect(page.getByTestId("card-photo-back")).toHaveAttribute("data-has-photo", "false");
  expect((await photoRows()).find((r) => r.id === back.id)!.removed).toBe(true);
  await expect(stat(`${STORAGE}/cards/${ids.tsk}/${back.id}.enc`)).rejects.toThrow();
  await page.context().close();
});

test("staf TSK lain (bukan 担当): tidak melihat nomor/foto/tombol di UI, HTML bersih, unduhan foto 404; Admin melihat dan bisa menampilkan", async ({ browser }) => {
  const [fresh] = (await photoRows()).filter((r) => !r.removed && r.side === "front");
  const other = await pageFor(browser, "tsk.staff2@hashi.test");
  await other.goto(url());
  await expect(other.getByTestId("card-section")).toHaveAttribute("data-can-edit", "false");
  await expect(other.getByTestId("card-secrets-restricted")).toBeVisible();
  await expect(other.getByTestId("card-secrets")).toHaveCount(0);
  await expect(other.getByTestId("card-number-show")).toHaveCount(0);
  const html = await other.content();
  expect(html).not.toContain(MASKED);
  expect(html).not.toContain(NUMBER);
  expect(html).not.toContain(fresh.id);
  expect((await other.request.get(`/records/cards/photo/${fresh.id}`)).status()).toBe(404);
  await other.context().close();

  const admin = await pageFor(browser, "tsk.admin@hashi.test");
  await admin.goto(url());
  await expect(admin.getByTestId("card-number-masked")).toHaveText(MASKED);
  await admin.getByTestId("card-number-show").click();
  await expect(admin.getByTestId("card-number-value")).toHaveText(NUMBER);
  expect((await admin.request.get(`/records/cards/photo/${fresh.id}`)).status()).toBe(200);
  await admin.context().close();
});

test("nomor dan foto tidak muncul di daftar kartu, KPI, dan beranda; LPK tidak bisa membuka halaman pekerja maupun unduhan", async ({ browser }) => {
  const [fresh] = (await photoRows()).filter((r) => !r.removed && r.side === "front");
  const admin = await pageFor(browser, "tsk.admin@hashi.test");
  for (const u of ["/records/cards", "/"]) {
    await admin.goto(u);
    const html = await admin.content();
    for (const bad of [NUMBER, MASKED, "12345678", fresh.id, "hcd1:"]) expect(html, `${u} memuat ${bad}`).not.toContain(bad);
  }
  await admin.context().close();
  const lpk = await pageFor(browser, "lpk1.admin@hashi.test");
  expect((await lpk.request.get(`/records/workers/${worker.id}`)).status()).toBe(404);
  expect([403, 404]).toContain((await lpk.request.get(`/records/cards/photo/${fresh.id}`)).status());
  await lpk.context().close();
});

test("hak hilang di tengah jalan: server menolak 'Tampilkan' (担当 berpindah setelah halaman terbuka) dengan pesan jelas dan tanpa audit", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(url());
  await expect(page.getByTestId("card-number-show")).toBeVisible();
  // 担当 dipindah ke staf lain SETELAH halaman terbuka
  const [p] = await ownerQuery<{ id: string }>("select id::text from placements where candidate_id = $1 and status = 'ACTIVE'", [worker.id]);
  await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $2, current_date, clock_timestamp())", [ids.tsk, ids.staffB, p.id]);
  await page.getByTestId("card-number-show").click();
  await expect(page.getByTestId("card-number-error")).toBeVisible();
  await expect(page.getByTestId("card-number-value")).toHaveCount(0);
  expect(await audits("residence_card.number_view")).toBe(2); // hanya dua tampil yang sah sebelumnya (staf A dan Admin); yang ditolak tidak tercatat sebagai berhasil
  await page.context().close();
});

test("kartu dibatalkan (Admin): nomor dihapus, semua foto ditandai dihapus dan berkas disk dibuang", async ({ browser }) => {
  const live = (await photoRows()).filter((r) => !r.removed);
  expect(live.length).toBeGreaterThan(0);
  const admin = await pageFor(browser, "tsk.admin@hashi.test");
  await admin.goto(url());
  await ensureOpen(admin, "card-void-toggle");
  await admin.locator("details:has([data-testid=card-void-toggle]) textarea").fill("Salah input (uji)");
  await admin.locator("details:has([data-testid=card-void-toggle]) button[type=submit]").click();
  await expect.poll(async () => (await ownerQuery("select 1 from residence_card_secrets where card_id = $1", [ids.card])).length).toBe(0);
  expect((await photoRows()).every((r) => r.removed)).toBe(true);
  for (const r of live) await expect(stat(`${STORAGE}/cards/${ids.tsk}/${r.id}.enc`)).rejects.toThrow();
  expect(await audits("residence_card.void")).toBe(1);
  await admin.context().close();
});
