import { expect, test, type Page } from "@playwright/test";
import { login, ownerQuery } from "./helpers";

// Tugas 2 UI: dashboard yang bisa diatur. Memakai lpk2.admin (tes lain tidak memakainya untuk tampilan dashboard) dan membersihkan barisnya.

const EMAIL = "lpk2.admin@hashi.test";
const wipe = () => ownerQuery("delete from user_dashboard_layouts where user_id = (select id from users where email = $1)", [EMAIL]);
const stored = async () => (await ownerQuery<{ layout: { v: number; items: Array<{ id: string; size?: string; hidden?: boolean }> } }>("select layout from user_dashboard_layouts where user_id = (select id from users where email = $1)", [EMAIL]))[0]?.layout;
const orderOf = async (page: Page, ids: string[]) => {
  const all = await page.locator("[data-testid^=w-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  return ids.map((i) => all.indexOf(`w-${i}`));
};

test.beforeEach(wipe);
test.afterAll(wipe);

test("atur dashboard: sembunyikan KPI, ubah ukuran, pindah urutan; tersimpan otomatis dan tetap ada setelah muat ulang", async ({ page }) => {
  await login(page, EMAIL);
  await expect(page.getByTestId("kpi-incomplete")).toBeVisible();
  await page.getByTestId("customize-toggle").click();
  await expect(page).toHaveURL(/\/\?atur=1/);
  await expect(page.getByTestId("layout-editor")).toBeVisible();

  await page.getByTestId("hide-kpi-incomplete").click();
  await page.getByTestId("size-full-stage-bar").click();
  await page.getByTestId("up-score-trend").click();
  await expect(page.getByTestId("layout-status")).toHaveText("Tersimpan");
  await expect(page.getByTestId("hidden-widgets")).toContainText("Profil belum lengkap");

  const row = await stored();
  expect(row.v).toBe(1);
  expect(row.items.find((i) => i.id === "kpi-incomplete")?.hidden).toBe(true);
  expect(row.items.find((i) => i.id === "stage-bar")?.size).toBe("full");

  await page.getByTestId("customize-toggle").click(); // Selesai
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("kpi-incomplete")).toHaveCount(0); // tidak ada di DOM
  await expect(page.getByTestId("kpi-passport")).toBeVisible();
  await expect(page.locator('[data-testid=widget-grid] > div:has([data-testid=w-stage-bar])')).toHaveAttribute("data-size", "full");
  const [trend, stage] = await orderOf(page, ["score-trend", "stage-bar"]);
  expect(trend).toBeLessThan(stage - 0); // score-trend dipindah ke atas, melewati stage-bar

  await page.reload();
  await expect(page.getByTestId("kpi-incomplete")).toHaveCount(0);
});

test("widget tersembunyi bisa ditampilkan lagi; 'Kembalikan ke bawaan' menghapus tata letak", async ({ page }) => {
  await login(page, EMAIL);
  await page.goto("/?atur=1");
  await page.getByTestId("hide-tsk-decisions").click();
  await expect(page.getByTestId("layout-status")).toHaveText("Tersimpan");
  await page.getByTestId("show-tsk-decisions").click();
  await expect(page.getByTestId("layout-status")).toHaveText("Tersimpan");
  expect((await stored()).items.find((i) => i.id === "tsk-decisions")?.hidden).toBeFalsy();

  await page.getByTestId("hide-kpi-passport").click();
  await expect(page.getByTestId("layout-status")).toHaveText("Tersimpan");
  await page.getByTestId("layout-reset").click();
  await expect(page.getByTestId("layout-status")).toHaveText("Tersimpan");
  await expect.poll(stored).toBeUndefined();
  await page.goto("/");
  await expect(page.getByTestId("kpi-passport")).toBeVisible();
});

test("tata letak milik sendiri: pengguna lain tidak terpengaruh", async ({ page, browser }) => {
  await login(page, EMAIL);
  await page.goto("/?atur=1");
  await page.getByTestId("hide-kpi-unshared").click();
  await expect(page.getByTestId("layout-status")).toHaveText("Tersimpan");

  const other = await (await browser.newContext()).newPage();
  await login(other, "lpk1.admin@hashi.test");
  await expect(other.getByTestId("kpi-unshared")).toBeVisible();
  await other.context().close();
});

test("data tersimpan yang usang/rusak tidak merusak dashboard (widget asing dibuang, yang kurang ditambahkan)", async ({ page }) => {
  for (const junk of [{ v: 1, items: [{ id: "widget-hantu" }, { id: "stage-bar", size: "raksasa" }] }, { x: 1 }, { v: 9, items: [] }]) {
    await wipe();
    await ownerQuery("insert into user_dashboard_layouts (user_id, org_id, layout) select id, organization_id, $2::jsonb from users where email = $1", [EMAIL, JSON.stringify(junk)]);
    await login(page, EMAIL);
    await page.goto("/");
    await expect(page.getByTestId("kpi-unrated")).toBeVisible();
    await expect(page.getByTestId("w-stage-bar")).toBeVisible();
    await expect(page.getByTestId("w-widget-hantu")).toHaveCount(0);
    await page.context().clearCookies();
  }
});

test("sensei: mode atur hanya menampilkan widget sensei", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto("/?atur=1");
  await expect(page.getByTestId("layout-editor")).toBeVisible();
  await expect(page.getByTestId("edit-bar-kpi-unrated")).toBeVisible();
  for (const id of ["tsk-decisions", "stage-bar", "score-trend", "kpi-passport", "kpi-unshared"]) await expect(page.getByTestId(`edit-bar-${id}`)).toHaveCount(0);
  await ownerQuery("delete from user_dashboard_layouts where user_id = (select id from users where email = 'lpk1.sensei@hashi.test')");
});

test("tombol atur hanya ada di Beranda", async ({ page }) => {
  await login(page, EMAIL);
  await expect(page.getByTestId("customize-toggle")).toBeVisible();
  await page.goto("/candidates");
  await expect(page.getByTestId("customize-toggle")).toHaveCount(0);
});

test.describe("ponsel", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("mode atur: tanpa scroll horizontal dan tombol kendali ≥ 44px", async ({ page }) => {
    await login(page, EMAIL);
    await page.goto("/?atur=1");
    await expect(page.getByTestId("layout-editor")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("hide-kpi-unrated").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });
});
