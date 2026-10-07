import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Daftar kartu izin tinggal /records/cards + KPI dashboard (T-019). Pekerja uji SENDIRI untuk SEMUA tahap (13 pekerja aktif + kartu), dibersihkan di afterAll.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date().toISOString();
const P = `UjiKartu${run}`;
const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

type Spec = { tag: string; stage: string; card?: { expiry: number; status: string; applied?: number; docs?: number; rejected?: number } };
// tengah rentang tiap tahap (±1 hari beda zona tidak mengubah hasil)
const SPECS: Spec[] = [
  { tag: "none", stage: "none", card: { expiry: 400, status: "not_started" } },
  { tag: "prepare", stage: "prepare", card: { expiry: 110, status: "not_started" } },
  { tag: "canapply", stage: "can_apply", card: { expiry: 75, status: "preparing" } },
  { tag: "h30", stage: "h30", card: { expiry: 25, status: "preparing" } },
  { tag: "h14", stage: "h14", card: { expiry: 10, status: "preparing" } },
  { tag: "h7", stage: "h7", card: { expiry: 4, status: "not_started" } },
  { tag: "expired", stage: "expired", card: { expiry: -5, status: "not_started" } },
  { tag: "waiting", stage: "waiting_result", card: { expiry: 60, status: "applied", applied: -3 } },
  { tag: "docs", stage: "waiting_result", card: { expiry: 60, status: "additional_docs", applied: -6, docs: -2 } },
  { tag: "special", stage: "waiting_result", card: { expiry: -10, status: "applied", applied: -30 } },
  { tag: "overdue", stage: "special_overdue", card: { expiry: -90, status: "applied", applied: -100 } },
  { tag: "rejected", stage: "rejected", card: { expiry: 200, status: "rejected", applied: -10, rejected: -3 } },
  { tag: "missing", stage: "missing" },
];
const URGENT = ["h30", "h14", "h7", "expired", "docs", "overdue", "rejected"];
const PREPARE = ["prepare", "canapply"];
const WAITING = ["waiting", "special"];
const MISSING = ["missing"];
let ids = { staffA: "", staffB: "", tsk: "", site: "" };
const created: string[] = [];

test.beforeAll(async () => {
  const [u] = await ownerQuery<{ a: string; b: string; tsk: string }>("select (select id::text from users where email = 'tsk.staff@hashi.test') as a, (select id::text from users where email = 'tsk.staff2@hashi.test') as b, (select id::text from organizations where name = 'TSK Demo Tokyo') as tsk");
  const [site] = await ownerQuery<{ id: string }>("select s.id::text as id from client_sites s join organizations o on o.id = s.org_id where o.name = 'TSK Demo Tokyo' order by s.id limit 1");
  ids = { staffA: u.a, staffB: u.b, tsk: u.tsk, site: site.id };
  const [fld] = await ownerQuery<{ id: string }>("select id::text from skill_fields where code = 'food'");
  for (const [i, spec] of SPECS.entries()) {
    const [c] = await ownerQuery<{ id: string }>(
      `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
       select o.id, $1, 'MALE', '2000-05-15', $2, 'READY', true from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id`, [`${P}-${spec.tag}`, fld.id]);
    created.push(c.id);
    const [p] = await ownerQuery<{ id: string }>("insert into placements (candidate_id, org_id, site_id, start_date, status) values ($1, $2, $3, current_date - 120, 'ACTIVE') returning id::text as id", [c.id, ids.tsk, ids.site]);
    // genap = 担当 staf A, ganjil = staf B (supaya 'milikku' membedakan)
    await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $4, current_date, clock_timestamp())", [ids.tsk, ids.staffA, p.id, i % 2 === 0 ? ids.staffA : ids.staffB]);
    if (spec.card) {
      const k = spec.card;
      const params: unknown[] = [ids.tsk, ids.staffA, c.id, fld.id, k.expiry, k.status];
      const dateCol = (v: number | undefined) => (v === undefined ? "null" : `current_date + $${params.push(v)}::int`);
      const applied = dateCol(k.applied);
      const docs = dateCol(k.docs);
      const rejected = dateCol(k.rejected);
      await ownerQuery(
        `insert into residence_cards (organization_id, created_by, candidate_id, skill_field_id, period_months, expiry_date, renewal_status, applied_on, additional_docs_on, rejected_on)
         values ($1, $2, $3, $4, 12, current_date + $5::int, $6, ${applied}, ${docs}, ${rejected})`, params);
    }
  }
});

test.afterAll(async () => {
  await ownerQuery("delete from residence_cards where candidate_id = any($1::uuid[])", [created]);
  await ownerQuery("delete from responsible_assignments where created_at >= $1", [startedAt]);
  await ownerQuery("delete from candidates where id = any($1::uuid[])", [created]); // penempatan ikut terhapus (cascade)
});

async function pageFor(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await login(page, email);
  return page;
}
const mineRows = (p: Page) => p.locator("[data-testid=card-row]", { hasText: P });
const tagsOf = async (p: Page) => (await mineRows(p).evaluateAll((els) => els.map((e) => e.querySelector("th")!.textContent!.trim()))).map((t) => t.replace(/^.*?-/, "").replace(/\s.*$/, "")).sort();
const kpi = async (p: Page, id: string) => Number(await p.getByTestId(`${id}-value`).textContent());

test("Admin (UI Jepang): semua tahap tampil benar per pekerja uji; urutan paling mendesak dulu, yang belum punya kartu paling akhir", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.admin@hashi.test");
  await page.goto("/records/cards");
  await expect(page.getByTestId("cards-page")).toBeVisible();
  await expect(mineRows(page)).toHaveCount(SPECS.length);
  for (const spec of SPECS) {
    const row = page.locator("[data-testid=card-row]", { hasText: `${P}-${spec.tag}` }).first();
    await expect(row, spec.tag).toHaveAttribute("data-stage", spec.stage);
  }
  // 追加資料 punya tanda; 特例期間 tampil; yang tanpa kartu = "belum ada data"
  await expect(page.locator("[data-testid=card-row]", { hasText: `${P}-docs` }).getByText("追加資料", { exact: true })).toBeVisible();
  await expect(page.locator("[data-testid=card-row]", { hasText: `${P}-special` })).toContainText("特例期間");
  // urutan: tahap dari atas ke bawah menurunkan urgensi
  const order = await mineRows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")));
  expect(order[0]).toBe("special_overdue");
  expect(order[order.length - 1]).toBe("missing");
  expect(order.indexOf("expired")).toBeLessThan(order.indexOf("h30"));
  expect(order.indexOf("h30")).toBeLessThan(order.indexOf("none"));
  await page.context().close();
});

test("kelompok: urgent = h30/h14/h7/lewat/追加資料/lewat 特例期間/ditolak; prepare = persiapan + boleh mengajukan; waiting = menunggu hasil TANPA 追加資料; missing = tanpa data (tidak ada yang ganda)", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test"); // UI Indonesia
  const expectView = async (view: string, tags: string[]) => {
    await page.goto(`/records/cards?view=${view}`);
    await expect(page.getByTestId(`card-view-${view}`)).toHaveAttribute("aria-current", "true");
    expect(await tagsOf(page), view).toEqual([...tags].sort());
  };
  await expectView("urgent", URGENT);
  await expectView("prepare", PREPARE);
  await expectView("waiting", WAITING);
  await expectView("missing", MISSING);
  await page.goto("/records/cards");
  expect((await tagsOf(page)).length).toBe(SPECS.length);
  // filter tahap
  await page.goto("/records/cards?stage=h14");
  expect(await page.locator("[data-testid=card-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")))).toEqual(expect.arrayContaining(["h14"]));
  for (const s of await page.locator("[data-testid=card-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")))) expect(s).toBe("h14");
  await page.context().close();
});

test("KPI dashboard = jumlah baris daftar: Admin (semua) untuk keempat KPI; staf (milikku) lewat tautan KPI; Admin saja punya 'tanpa data'", async ({ browser }) => {
  const admin = await pageFor(browser, "tsk.admin@hashi.test");
  await admin.goto("/");
  await expect(admin.getByTestId("kpi-card-urgent")).toBeVisible();
  const aK = { urgent: await kpi(admin, "kpi-card-urgent"), prepare: await kpi(admin, "kpi-card-prepare"), waiting: await kpi(admin, "kpi-card-waiting"), missing: await kpi(admin, "kpi-card-missing") };
  await admin.goto("/records/cards");
  for (const v of ["urgent", "prepare", "waiting", "missing"] as const) expect(Number(await admin.getByTestId(`card-view-${v}`).getAttribute("data-count")), `Admin ${v}`).toBe(aK[v]);
  // tautan KPI membuka kelompok yang sama dengan angka yang sama
  await admin.goto("/");
  await admin.getByTestId("kpi-card-urgent").click();
  await expect(admin).toHaveURL(/\/records\/cards\?view=urgent$/);
  expect(Number(await admin.getByTestId("card-count").getAttribute("data-n"))).toBe(aK.urgent);
  await admin.context().close();

  const staff = await pageFor(browser, "tsk.staff@hashi.test");
  await staff.goto("/");
  await expect(staff.getByTestId("kpi-card-urgent")).toBeVisible();
  await expect(staff.getByTestId("kpi-card-missing")).toHaveCount(0); // hanya Admin
  for (const [kid, v] of [["kpi-card-urgent", "urgent"], ["kpi-card-prepare", "prepare"], ["kpi-card-waiting", "waiting"]] as const) {
    const n = await kpi(staff, kid);
    await staff.goto("/");
    await staff.getByTestId(kid).click();
    await expect(staff).toHaveURL(new RegExp(`/records/cards\\?view=${v}&mine=1$`));
    expect(Number(await staff.getByTestId("card-count").getAttribute("data-n")), `staf ${v}`).toBe(n);
    for (const r of await staff.locator("[data-testid=card-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-responsible")))) expect(r).toBe(ids.staffA);
    await staff.goto("/");
  }
  // staf tidak melihat milik staf lain di "milikku"; tanpa filter melihat semua
  await staff.goto("/records/cards?mine=1");
  const mineTags = await tagsOf(staff);
  expect(mineTags.length).toBe(Math.ceil(SPECS.length / 2)); // indeks genap = staf A
  await staff.goto("/records/cards");
  expect((await tagsOf(staff)).length).toBe(SPECS.length);
  await staff.context().close();
});

test("menu sungguhan (bukan 'segera hadir'): Kartu izin tinggal di sidebar dan tab Catatan kegiatan; widget segera-hadir hilang; LPK dan sensei 404", async ({ browser }) => {
  const staff = await pageFor(browser, "tsk.staff@hashi.test");
  await staff.goto("/");
  await expect(staff.locator("nav a[href='/records/cards']").first()).toBeVisible();
  await expect(staff.getByTestId("nav-soon")).toHaveCount(0);
  await expect(staff.getByTestId("w-coming-soon")).toHaveCount(0);
  await staff.goto("/records");
  await expect(staff.getByTestId("records-tabs").locator("a[href='/records/cards']")).toBeVisible();
  await staff.locator("nav a[href='/records/cards']").first().click();
  await expect(staff).toHaveURL(/\/records\/cards/);
  await staff.context().close();
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test"]) {
    const page = await pageFor(browser, email);
    expect((await page.goto("/records/cards"))?.status(), email).toBe(404);
    await page.context().close();
  }
});

test("ponsel 390 px: daftar tanpa gulir horizontal halaman; dashboard TSK_ADMIN tetap 2 kartu per baris", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test", { width: 390, height: 844 });
  await page.goto("/records/cards");
  await expect(page.getByTestId("card-table")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto("/");
  await expect(page.getByTestId("kpi-card-urgent")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.context().close();
});
