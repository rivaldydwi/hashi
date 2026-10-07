import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers";

// Kartu KPI dashboard ringkas dan bernada (T-012). Tata letak: tinggi kartu, jumlah baris, kolom di ponsel. Nada: KPI tindakan menyala hanya bila nilainya > 0.

async function pageFor(browser: Browser, email: string, width: number, height = 900): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  await login(page, email);
  return page;
}
const cards = (page: Page) => page.locator("[data-testid=kpi-row] > a");
const boxes = (page: Page) => cards(page).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height), id: e.getAttribute("data-testid") }; }));

test("TSK_ADMIN 1280px: semua KPI muat dalam <= 3 baris (13 KPI sejak T-019; sebelumnya 9 = 2 baris), tiap kartu <= 110 px dan sama tinggi dalam satu baris, widget berikutnya terlihat tanpa menggulir", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test", 1280);
  await expect(page.getByTestId("kpi-staff-over")).toBeVisible();
  const b = await boxes(page);
  expect(b.length).toBeGreaterThanOrEqual(7);
  const rows = [...new Set(b.map((x) => x.top))];
  // T-019 menambah 4 KPI kartu izin tinggal (urgent, prepare, waiting, missing): 13 KPI pada 5 kolom = 3 baris. Tinggi kartu, kesamaan tinggi per baris, dan "widget terlihat tanpa menggulir" tetap dijaga.
  expect(rows.length, JSON.stringify(b)).toBeLessThanOrEqual(3);
  expect(b.length).toBeLessThanOrEqual(13);
  for (const x of b) { expect(x.h, x.id!).toBeLessThanOrEqual(110); expect(x.h, x.id!).toBeGreaterThanOrEqual(44); }
  for (const top of rows) expect(new Set(b.filter((x) => x.top === top).map((x) => x.h)).size, `tinggi sebaris ${top}`).toBe(1);
  const first = await page.locator("[data-testid=widget-grid] > *").first().boundingBox();
  expect(first!.y, "widget pertama terlihat tanpa menggulir").toBeLessThan(900 - 60);
  await page.context().close();
});

test("ponsel 390px (LPK_ADMIN dan TSK_ADMIN): 2 kartu per baris, tanpa gulir horizontal", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "tsk.admin@hashi.test"]) {
    const page = await pageFor(browser, email, 390, 844);
    await expect(cards(page).first()).toBeVisible();
    const b = await boxes(page);
    const perRow = Object.values(b.reduce<Record<number, number>>((m, x) => ({ ...m, [x.top]: (m[x.top] ?? 0) + 1 }), {}));
    expect(Math.max(...perRow), `${email} ${JSON.stringify(perRow)}`).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.context().close();
  }
});

test("nada mengikuti nilai: KPI tindakan bernilai 0 = calm (ikon centang, teks 'beres'), > 0 = attention; KPI informasi tetap info; kartu tetap tautan >= 44 px dengan fokus terlihat", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test", 1280);
  await expect(page.getByTestId("kpi-awaiting")).toBeVisible();
  const all = await cards(page).evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-testid")!, look: e.getAttribute("data-look")!, value: Number(e.querySelector("[data-testid$=-value]")!.textContent), text: e.textContent ?? "", href: e.getAttribute("href") })));
  const attentionIds = ["kpi-awaiting", "kpi-records-unread", "kpi-interviews-pending", "kpi-followups-open", "kpi-staff-over", "kpi-unassigned"];
  for (const k of all.filter((x) => attentionIds.includes(x.id))) {
    expect(k.look, `${k.id}=${k.value}`).toBe(k.value > 0 ? "attention" : "calm");
    if (k.value === 0) expect(k.text).toContain("問題なし"); // ja: teks "beres"
  }
  for (const id of ["kpi-new-shared", "kpi-open-jobs", "kpi-placed"]) expect(all.find((x) => x.id === id)?.look, id).toBe("info");
  // seed: ada KPI tindakan bernilai 0 DAN > 0, jadi kedua tampilan teruji di data nyata
  expect(all.some((k) => k.look === "calm")).toBe(true);
  expect(all.some((k) => k.look === "attention")).toBe(true);
  for (const k of all) expect(k.href, k.id).toMatch(/^\//);
  // fokus keyboard terlihat pada kartu
  await page.getByTestId("kpi-awaiting").focus();
  await page.keyboard.press("Shift+Tab"); // modalitas papan ketik supaya :focus-visible berlaku
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("kpi-awaiting")).toBeFocused();
  const outline = await page.getByTestId("kpi-awaiting").evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(outline).not.toBe("none");
  await page.context().close();
});

test("KPI bernilai > 0 memuat teks 'perlu tindakan' untuk pembaca layar (warna bukan satu-satunya pembeda); id: teks 'Beres' pada yang tenang", async ({ browser }) => {
  const page = await pageFor(browser, "lpk1.admin@hashi.test", 1280); // bahasa Indonesia
  await expect(cards(page).first()).toBeVisible();
  const items = await cards(page).evaluateAll((els) => els.map((e) => ({ look: e.getAttribute("data-look"), text: e.textContent ?? "", sr: e.querySelector(".sr-only")?.textContent ?? "" })));
  for (const k of items) {
    if (k.look === "attention") expect(k.sr).toContain("Perlu tindakan");
    if (k.look === "calm") expect(k.text).toContain("Beres");
  }
  await page.context().close();
});
