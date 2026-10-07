import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers";

// Tabel lebar dalam bahasa Jepang (T-011): teks Jepang tidak punya spasi, jadi tanpa aturan khusus kolom sempit memecah header dan nama per HURUF
// (baris setinggi setengah layar). Tes ini menjaga supaya tidak mundur: header tidak lebih tinggi dari ~2 baris, baris grid tidak menjulang,
// dan aturan hanya berlaku di bahasa Jepang (Indonesia tidak berubah).

async function pageFor(browser: Browser, email: string, width: number): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  await login(page, email);
  return page;
}
const heights = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));

for (const width of [1280, 1440]) {
  test(`grid 定期面談 (ja, ${width}px): header satu-dua baris, baris tidak menjulang, nama perusahaan tidak patah per huruf`, async ({ browser }) => {
    const page = await pageFor(browser, "tsk.admin@hashi.test", width); // seed: bahasa tampilan Jepang
    await page.goto("/records/interviews");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    const heads = await heights(page, "[data-testid=interview-grid] thead th");
    expect(heads.length).toBeGreaterThan(8);
    for (const h of heads) expect(h, `tinggi header ${heads}`).toBeLessThanOrEqual(52); // <= 2 baris teks xs
    const rows = await heights(page, "[data-testid=interview-row]");
    expect(rows.length).toBeGreaterThan(0);
    for (const h of rows) expect(h, `tinggi baris ${rows}`).toBeLessThanOrEqual(130); // sebelumnya ~377px
    // sel perusahaan: lebarnya cukup untuk nama + tidak setinggi tumpukan huruf (nama 10 huruf, satu-dua baris saja)
    const company = page.locator("[data-testid=interview-row]").first().locator("td").nth(2); // td ke-3: 配属先企業名 (nama baris = th)
    const box = await company.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(150);
    expect(box!.height).toBeLessThanOrEqual(110);
    await page.context().close();
  });
}

test("daftar tahunan, daftar kandidat, dan job order (ja, 1024px): header satu baris dan baris tidak menjulang", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test", 1024);
  for (const [url, maxRow] of [["/records/interviews/annual", 130], ["/candidates", 110], ["/job-orders", 110]] as const) {
    await page.goto(url);
    const heads = await heights(page, "table thead th");
    expect(heads.length, url).toBeGreaterThan(3);
    for (const h of heads) expect(h, `${url} header ${heads}`).toBeLessThanOrEqual(52);
    const rows = await heights(page, "table tbody tr");
    for (const h of rows) expect(h, `${url} baris ${rows}`).toBeLessThanOrEqual(maxRow);
  }
  await page.context().close();
});

test("aturan hanya untuk bahasa Jepang: di bahasa Indonesia header boleh membungkus (white-space normal) dan tidak ada gulir horizontal halaman", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test", 390); // ponsel, bahasa Indonesia
  await page.goto("/records/interviews");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  const ws = await page.locator("[data-testid=interview-grid] thead th").first().evaluate((e) => getComputedStyle(e).whiteSpace);
  expect(ws).toBe("normal");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto("/candidates"); // tampilan kartu di ponsel tetap berfungsi
  await expect(page.getByTestId("candidate-row").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.context().close();
});
