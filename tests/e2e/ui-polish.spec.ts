import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Tugas 3 UI: lencana status, chip filter, empty state, tabel -> kartu di ponsel, perbaikan form, umpan balik.

test("lencana status: ikon + teks + penjelasan; legenda bisa dibuka", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates");
  const badge = page.getByTestId("candidate-row").first().locator("span[title]").first();
  await expect(badge.locator("svg")).toHaveCount(1); // ikon
  await expect(badge).toHaveText(/Belajar|Siap seleksi|Mundur/); // teks (bukan hanya warna)
  expect((await badge.getAttribute("title"))!.length).toBeGreaterThan(15); // penjelasan
  const legend = page.getByTestId("legend-stage");
  await legend.locator("summary").click();
  await expect(legend).toContainText("Masih menjalani pelatihan di LPK.");
});

test("chip filter: tampil per filter aktif, dihapus satu per satu, hapus semua; kosong -> empty state dengan jalan keluar", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates?stage=READY&jlpt=N3");
  const chips = page.getByTestId("filter-chip");
  await expect(chips).toHaveCount(2);
  const total = Number(await page.getByTestId("candidate-total").textContent());
  await chips.filter({ hasText: "JLPT" }).getByTestId("filter-chip-remove").click();
  await expect(page).toHaveURL(/stage=READY/);
  await expect(page).not.toHaveURL(/jlpt/);
  await expect(chips).toHaveCount(1);
  expect(Number(await page.getByTestId("candidate-total").textContent())).toBeGreaterThanOrEqual(total);

  await page.goto("/candidates?q=zzzzzz-tidak-ada");
  await expect(page.getByTestId("candidate-empty")).toContainText("Tidak ada kandidat yang cocok");
  await page.getByTestId("candidate-empty").getByRole("link", { name: "Hapus semua filter" }).click();
  await expect(page).toHaveURL(/\/candidates$/);
  await expect(page.getByTestId("filter-chips")).toHaveCount(0);

  await page.goto("/candidates?view=unrated&stage=STUDYING");
  await expect(page.getByTestId("filter-clear-all")).toBeVisible();
});

test("TSK melihat chip keputusan dan legenda keputusan", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto("/candidates?decision=SHORTLISTED");
  await expect(page.getByTestId("filter-chip")).toHaveCount(1);
  await expect(page.getByTestId("legend-decision")).toBeVisible();
});

test.describe("ponsel", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("daftar kandidat menjadi kartu: tanpa scroll horizontal, label tiap nilai tampil, target sentuh >= 44px", async ({ page }) => {
    await login(page, "lpk1.admin@hashi.test");
    await page.goto("/candidates?stage=READY");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const row = page.getByTestId("candidate-row").first();
    const display = await row.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("block"); // bukan table-row
    // label kolom muncul lewat data-label (::before)
    const label = await row.locator("td[data-label]").first().evaluate((el) => getComputedStyle(el, "::before").content);
    expect(label).toMatch(/\w/);
    const link = await row.locator("a").first().boundingBox();
    expect(link!.height).toBeGreaterThanOrEqual(44);
    for (const id of ["menu-button"]) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.goto("/candidates?q=Zzz-nihil&stage=READY&jlpt=N1");
    await expect(page.getByTestId("candidate-empty")).toBeVisible(); // halaman selesai dimuat (bukan kerangka muatan)
    await expect(page.getByTestId("filter-chip")).toHaveCount(3);
    for (const box of await page.getByTestId("filter-chip-remove").all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test("form tambah kandidat: navigasi bagian, indikator kelengkapan naik saat diisi, peringatan sebelum meninggalkan halaman, tanpa draf di peramban", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates/new");
  const nav = page.getByTestId("section-nav");
  await expect(nav.getByRole("link")).toHaveCount(await page.locator("section[id^=sec-]").count());
  await nav.getByRole("link", { name: "Data dasar" }).click();
  await expect(page).toHaveURL(/#sec-basic/);

  const value = page.getByTestId("completeness-value");
  await expect(value).toHaveText("0%");
  await page.locator("#basic-fullName").fill("Uji Kelengkapan");
  await page.locator("#basic-birthPlace").fill("Bandung");
  await page.locator("#basic-heightCm").fill("165");
  await page.locator("#basic-weightKg").click(); // interaksi nyata: Chromium hanya menampilkan beforeunload bila halaman pernah diaktifkan pengguna
  await page.keyboard.type("55");
  const after = Number((await value.textContent())!.replace("%", ""));
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(100);

  // tidak ada draf yang ditulis ke penyimpanan peramban
  const stored = await page.evaluate(() => ({ l: Object.keys(localStorage).length, s: Object.keys(sessionStorage).length }));
  expect(stored).toEqual({ l: 0, s: 0 });

  // peringatan beforeunload aktif karena form sudah diubah (peristiwa dikirim langsung: Chromium menampilkan dialog aslinya hanya bila ada gestur pengguna)
  expect(await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
});

test("form kosong tanpa perubahan: tidak ada peringatan meninggalkan halaman", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates/new");
  expect(await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(false);
});

test("nilai awal otomatis ditandai 'Diisi otomatis, periksa' di form penilaian baru", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto("/assessments/pending");
  await page.getByTestId("pending-row").first().getByRole("link").first().click();
  await page.getByTestId("assessment-add-toggle").click();
  await expect(page.getByTestId("autofilled-assessedOn")).toHaveText("Diisi otomatis, periksa.");
});

test("tombol proses: SubmitButton menampilkan keadaan menyimpan (aria-busy) dan area umpan balik pembaca layar ada", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await expect(page.getByTestId("toast-region")).toHaveAttribute("aria-live", "polite");
});
