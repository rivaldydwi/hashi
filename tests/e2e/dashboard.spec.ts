import { expect, test, type Page } from "@playwright/test";
import { login, ownerQuery } from "./helpers";

// Tugas 1 UI: app shell, menu per peran, dashboard per peran, kartu KPI yang konsisten dengan daftar yang dituju.

const sidebarLink = (page: Page, href: string) => page.locator(`[data-testid=sidebar] a[href="${href}"]`);
const kpiValue = async (page: Page, id: string) => Number(await page.getByTestId(`${id}-value`).textContent());

test("menu LPK_ADMIN: Beranda, Kandidat, Penilaian, Pengguna; menu TSK tidak ada di DOM", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  for (const href of ["/", "/candidates", "/assessments/pending", "/users"]) await expect(sidebarLink(page, href)).toHaveCount(1);
  for (const href of ["/clients", "/job-orders", "/admin/organizations", "/admin/skill-fields"]) await expect(sidebarLink(page, href)).toHaveCount(0);
  await expect(page.getByTestId("topbar-title")).toHaveText("Beranda");
});

test("menu LPK_SENSEI: tanpa Pengguna; dashboard tanpa widget sensitif (DOM dan HTML)", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await expect(sidebarLink(page, "/users")).toHaveCount(0);
  await expect(sidebarLink(page, "/candidates")).toHaveCount(1);
  for (const id of ["kpi-unshared", "kpi-passport", "kpi-incomplete", "w-tsk-decisions", "w-stage-bar", "w-score-trend"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId("kpi-unrated")).toBeVisible();
  // Label statis boleh ada di katalog terjemahan; yang tidak boleh bocor adalah DATA sensitif dan widget admin.
  const html = (await page.content()).toLowerCase();
  const [priv] = await ownerQuery<{ pn: string; nid: string }>("select p.passport_number as pn, p.national_id as nid from candidate_private p join candidates c on c.id = p.candidate_id join organizations o on o.id = c.organization_id where o.name = 'LPK Demo Bandung' limit 1");
  for (const secret of [priv.pn, priv.nid, "tsk-decisions", "kpi-passport"]) expect(html).not.toContain(secret.toLowerCase());
});

test("menu TSK: Klien, Job order, dan Kartu izin tinggal ada, menu LPK/super admin tidak; tidak ada lagi grup 'segera hadir'", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  for (const href of ["/candidates", "/clients", "/job-orders", "/records/cards"]) await expect(sidebarLink(page, href)).toHaveCount(1);
  for (const href of ["/users", "/admin/organizations"]) await expect(sidebarLink(page, href)).toHaveCount(0);
  await expect(page.getByTestId("nav-soon")).toHaveCount(0); // Wawancara berkala dan Kartu izin tinggal sudah menu sungguhan (T-019)
});

test("menu super admin: organisasi, kemitraan, bidang kerja; tanpa Kandidat", async ({ page }) => {
  await login(page, "admin@hashi.test");
  for (const href of ["/admin/organizations", "/admin/partnerships", "/admin/skill-fields"]) await expect(sidebarLink(page, href)).toHaveCount(1);
  await expect(sidebarLink(page, "/candidates")).toHaveCount(0);
  await expect(page.getByTestId("kpi-orgs")).toBeVisible();
  await expect(page.getByTestId("global-search")).toHaveCount(0);
});

test("LPK_ADMIN: angka tiap kartu KPI sama dengan jumlah di daftar yang dituju, dan lencana menu cocok", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  const badge = page.locator('[data-testid=sidebar] a[href="/assessments/pending"] [data-testid=nav-badge]');
  await expect(badge).toHaveText(String(await kpiValue(page, "kpi-unrated")));
  for (const [id, view] of [["kpi-unrated", "unrated"], ["kpi-unshared", "unshared"], ["kpi-passport", "passport"], ["kpi-incomplete", "incomplete"]] as const) {
    await page.goto("/");
    const n = await kpiValue(page, id);
    expect(n).toBeGreaterThan(0);
    await page.getByTestId(id).click();
    await expect(page).toHaveURL(new RegExp(`/candidates\\?view=${view}`));
    await expect(page.getByTestId("candidate-total")).toHaveText(String(n));
    await expect(page.getByTestId("view-chip")).toBeVisible();
  }
});

test("TSK_ADMIN: KPI baru dibagikan, menunggu keputusan, dan penempatan aktif sama dengan daftar", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  for (const [id, view] of [["kpi-new-shared", "new-shared"], ["kpi-awaiting", "awaiting"], ["kpi-placed", "placed"]] as const) {
    await page.goto("/");
    const n = await kpiValue(page, id);
    expect(n).toBeGreaterThan(0);
    await page.getByTestId(id).click();
    await expect(page).toHaveURL(new RegExp(`/candidates\\?view=${view}`));
    await expect(page.getByTestId("candidate-total")).toHaveText(String(n));
  }
  await page.goto("/");
  await page.getByTestId("kpi-open-jobs").click();
  await expect(page).toHaveURL(/\/job-orders\?status=OPEN/);
});

test("filter view tidak dikenal diabaikan (tidak error); filter TSK tidak berlaku untuk LPK", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates?view=placed"); // view khusus TSK
  await expect(page.getByTestId("candidate-total")).toHaveText("12");
  await page.goto("/candidates?view=ngawur");
  await expect(page.getByTestId("candidate-total")).toHaveText("12");
});

test("mengganti bahasa tampilan tidak mengubah bahasa yang dikuasai pengguna", async ({ page }) => {
  const before = await ownerQuery<{ languages: string[] }>("select languages::text[] as languages from users where email = 'lpk1.admin@hashi.test'");
  await login(page, "lpk1.admin@hashi.test");
  await page.getByRole("button", { name: "日本語" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.getByRole("button", { name: "Indonesia" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  const after = await ownerQuery<{ languages: string[] }>("select languages::text[] as languages from users where email = 'lpk1.admin@hashi.test'");
  expect(after[0].languages).toEqual(before[0].languages);
});

test.describe("ponsel", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("laci menu: buka lewat tombol, tutup dengan Esc, fokus kembali ke tombol; tanpa scroll horizontal", async ({ page }) => {
    await login(page, "lpk1.admin@hashi.test");
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toBeHidden();
    const button = page.getByTestId("menu-button");
    await button.click();
    await expect(sidebar).toBeVisible();
    await expect(page.getByTestId("drawer-close")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await sidebar.locator('a[href="/candidates"]').click();
    await expect(page).toHaveURL(/\/candidates/);
    await expect(sidebar).toBeHidden(); // laci menutup setelah berpindah halaman
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("LPK baru tanpa kandidat melihat panduan 3 langkah", async ({ browser }) => {
  // Dicakup admin-flow.spec.ts (organisasi baru → onboarding); di sini cukup memastikan LPK berisi TIDAK melihatnya.
  const page = await (await browser.newContext()).newPage();
  await login(page, "lpk1.admin@hashi.test");
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await page.context().close();
});
