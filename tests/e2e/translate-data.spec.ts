import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery } from "./helpers";

// Terjemahan peramban (T-016, dikoreksi T-023): LABEL dan TEKS BEBAS (motivasi, catatan, isi catatan kegiatan, ...) boleh diterjemahkan; hanya IDENTITAS
// (nama, katakana, perusahaan, alamat, telepon, email, kode, merek) dikunci. Tes memeriksa atribut `translate="no"` pada identitas dan memastikan label/teks bebas
// TIDAK ikut ditandai (dan tidak ada `lang` pada teks bebas), dan `<html>` tidak pernah ditandai.

async function pageFor(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, email);
  return page;
}
/** Apakah elemen berada di dalam (atau adalah) bagian yang ditandai translate=no? */
const noTranslate = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => !!e.closest('[translate="no"]'));

test("<html> dan <body> tidak pernah translate=no, tanpa meta notranslate (terjemahan peramban tidak diblokir total)", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test");
  for (const url of ["/", "/candidates", "/records/interviews", "/users"]) {
    await page.goto(url);
    expect(await page.locator("html").getAttribute("translate"), url).toBeNull();
    expect(await page.locator("body").getAttribute("translate"), url).toBeNull();
    await expect(page.locator('meta[name="google"][content="notranslate"]')).toHaveCount(0);
  }
  await page.context().close();
});

test("daftar kandidat dan grid 定期面談 (TSK): sel nama/katakana/perusahaan = translate=no; judul kolom, judul halaman, menu = bisa diterjemahkan", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test");
  await page.goto("/candidates");
  await expect(page.getByTestId("candidate-row").first()).toBeVisible();
  expect(await noTranslate(page, "[data-testid=candidate-row] a[href^='/candidates/']"), "nama kandidat").toBe(true);
  expect(await noTranslate(page, "[data-testid=candidate-row] td[data-label]"), "nama LPK").toBe(true);
  expect(await noTranslate(page, "[data-testid=candidate-table] thead th"), "judul kolom").toBe(false);
  expect(await noTranslate(page, "h1"), "judul halaman").toBe(false);
  expect(await noTranslate(page, "nav a"), "menu").toBe(false);
  await page.goto("/records/interviews");
  await expect(page.getByTestId("interview-row").first()).toBeVisible();
  const row = page.getByTestId("interview-row").first();
  expect(await row.locator("th").first().evaluate((e) => !!e.closest('[translate="no"]')), "nama pekerja").toBe(true);
  for (const i of [2, 3, 4, 5, 6]) expect(await row.locator("td").nth(i).evaluate((e) => !!e.closest('[translate="no"]')), `sel data ke-${i} (perusahaan, penanggung jawab, alamat, telepon, PIC)`).toBe(true);
  expect(await noTranslate(page, "[data-testid=interview-grid] thead th"), "judul kolom grid").toBe(false);
  expect(await noTranslate(page, "[data-testid=interview-legend]"), "legenda").toBe(false);
  await page.context().close();
});

test("detail kandidat (LPK, bahasa Indonesia): nama dan nilai isian = translate=no, katakana lang=ja; label bagian dan nama kolom tetap bisa diterjemahkan", async ({ browser }) => {
  const page = await pageFor(browser, "lpk1.admin@hashi.test");
  await page.goto("/candidates");
  const first = page.getByTestId("candidate-row").first().locator("a[href^='/candidates/']");
  const name = (await first.textContent())!.trim();
  await first.click();
  await expect(page.locator("h1")).toContainText(name);
  expect(await page.locator("h1").getAttribute("translate")).toBe("no");
  const kana = page.locator("h1 + p");
  await expect(kana).toHaveAttribute("translate", "no");
  await expect(kana).toHaveAttribute("lang", "ja");
  expect(await noTranslate(page, "[data-testid=value-fullName]"), "nilai isian").toBe(true);
  expect(await page.locator("[data-testid=value-fullName]").first().locator("xpath=preceding-sibling::dt").first().evaluate((e) => !!e.closest('[translate="no"]')), "nama kolom (dt)").toBe(false);
  await page.context().close();
});

test("daftar kandidat bahasa Indonesia: katakana ber-lang=ja; shell: nama organisasi, nama dan email pengguna translate=no", async ({ browser }) => {
  const page = await pageFor(browser, "lpk1.admin@hashi.test");
  await page.goto("/candidates");
  await expect(page.getByTestId("candidate-row").first()).toBeVisible();
  const kana = page.locator("[data-testid=candidate-row] td [lang=ja]").first();
  await expect(kana).toBeVisible();
  for (const text of ["lpk1.admin@hashi.test"]) expect(await page.getByText(text, { exact: true }).first().evaluate((e) => !!e.closest('[translate="no"]')), text).toBe(true);
  expect(await page.locator("aside, nav").first().evaluate((e) => e.getAttribute("translate"))).toBeNull(); // sidebar secara keseluruhan tidak ditandai
  await page.context().close();
});

test("catatan kegiatan, klien, job order, pengguna: data translate=no, label tidak", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test");
  await page.goto("/records");
  await expect(page.getByTestId("record-row").first()).toBeVisible();
  const byline = page.getByTestId("record-row").first().locator("p.text-xs");
  expect(await byline.evaluate((e) => !!e.closest('[translate="no"]')), "baris penulis seluruhnya tidak ditandai").toBe(false);
  expect(await byline.locator('[translate="no"]').count(), "nama penulis ditandai").toBeGreaterThan(0);
  await page.goto("/clients");
  await expect(page.getByTestId("company-name").first()).toHaveAttribute("translate", "no");
  await page.goto("/job-orders");
  expect(await noTranslate(page, "table tbody tr td a"), "judul job order").toBe(true);
  expect(await noTranslate(page, "table thead th"), "judul kolom job order").toBe(false);
  await page.goto("/users");
  expect(await page.locator("table tbody tr").first().locator("td").first().locator('[translate="no"]').count(), "nama dan email pengguna").toBeGreaterThanOrEqual(2);
  expect(await noTranslate(page, "table thead th"), "judul kolom pengguna").toBe(false);
  await page.context().close();
});

const inNo = (loc: import("@playwright/test").Locator) => loc.first().evaluate((e) => !!e.closest('[translate="no"]'));

test("T-023 detail kandidat: identitas dikunci, teks bebas (motivasi, PR diri) dan ringkasan baris berulang menurut sifat kolom", async ({ browser }) => {
  const page = await pageFor(browser, "lpk1.admin@hashi.test");
  const [row] = await ownerQuery<{ id: string }>(`select c.id from candidates c join candidate_private p on p.candidate_id = c.id join candidate_family_members f on f.candidate_id = c.id where c.motivation is not null and p.address is not null and f.occupation is not null limit 1`);
  await page.goto(`/candidates/${row.id}`);
  await expect(page.getByTestId("value-motivation")).toBeVisible();
  for (const id of ["fullName", "address", "phone"]) expect(await inNo(page.getByTestId(`value-${id}`)), `identitas ${id}`).toBe(true);
  for (const id of ["motivation", "selfPr"]) {
    const v = page.getByTestId(`value-${id}`);
    if (await v.count()) {
      expect(await inNo(v), `teks bebas ${id}`).toBe(false);
      expect(await v.first().evaluate((e) => !!e.closest("[lang]") && e.closest("[lang]") !== document.documentElement), `tanpa lang pada ${id}`).toBe(false);
    }
  }
  // ringkasan keluarga: "<hubungan> · <nama> · <pekerjaan>": nama dikunci, hubungan dan pekerjaan bisa diterjemahkan
  const summary = page.getByTestId("section-family").getByTestId("row-summary").first();
  const parts = summary.locator(":scope > span");
  expect(await parts.count()).toBeGreaterThanOrEqual(2);
  expect(await summary.evaluate((e) => !!e.closest('[translate="no"]')), "baris ringkasan secara keseluruhan tidak dikunci").toBe(false);
  expect(await parts.nth(0).locator("span").first().getAttribute("translate"), "hubungan (pilihan)").toBeNull();
  expect(await parts.nth(1).locator("span").first().getAttribute("translate"), "nama anggota keluarga").toBe("no");
  await page.context().close();
});

test("T-023 catatan TSK pada detail kandidat tidak dikunci", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test");
  const [row] = await ownerQuery<{ id: string }>(`select c.id from candidates c where c.shared_with_tsk and exists (select 1 from candidate_notes n where n.candidate_id = c.id) limit 1`);
  await page.goto(`/candidates/${row.id}`);
  const body = page.getByTestId("note-body").first();
  await expect(body).toBeVisible();
  expect(await inNo(body), "isi catatan TSK").toBe(false);
  await page.context().close();
});

test("T-023 isi catatan kegiatan dan catatan kuartal tidak dikunci; merek Hashi dikunci", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test");
  const [rec] = await ownerQuery<{ id: string; action_taken: string }>(`select id, action_taken from activity_records where kind = 'daily_work' and status = 'active' and action_taken is not null order by created_at limit 1`);
  await page.goto(`/records/${rec.id}`);
  const body = page.locator("p", { hasText: rec.action_taken.split("\n")[0].slice(0, 12) }).first();
  await expect(body).toBeVisible();
  expect(await inNo(body), "isi catatan kegiatan").toBe(false);
  expect(await body.evaluate((e) => !!e.closest("[lang]") && e.closest("[lang]") !== document.documentElement), "tanpa lang").toBe(false);
  expect(await inNo(page.getByTestId("build-version")), "merek Hashi").toBe(true);

  await page.goto("/records/interviews");
  const note = page.getByTestId("quarter-cell").locator("span.whitespace-pre-wrap", { hasNotText: "—" }).first();
  await expect(note).toBeVisible();
  expect(await inNo(note), "catatan kuartal").toBe(false);
  await page.context().close();
});
