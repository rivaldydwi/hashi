import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Status pekerja untuk LPK (T-024): TSK (Admin/担当) mengisi tanggal tiba; LPK_ADMIN pemilik melihat tanggal tiba + status visa + berlaku sampai SAJA (HTML tanpa klien/lokasi/job order/kartu);
// sensei, LPK lain, kemitraan nonaktif, dan kandidat tidak dibagikan tidak melihatnya. Pekerja uji SENDIRI; dibersihkan di afterAll.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date().toISOString();
const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const CARD_NOTE = `catatan-rahasia-kartu-${run}`;
let worker = { id: "", name: "" };
let ids = { staffA: "", tsk: "", site: "", card: "", lpk: "" };
let hidden: string[] = []; // teks yang TIDAK boleh muncul di halaman LPK

test.beforeAll(async () => {
  const [u] = await ownerQuery<{ a: string; tsk: string }>("select (select id::text from users where email = 'tsk.staff@hashi.test') as a, (select organization_id::text from users where email = 'tsk.staff@hashi.test') as tsk");
  const [site] = await ownerQuery<{ id: string; site: string; company: string }>("select s.id::text as id, s.name as site, cc.name as company from client_sites s join client_companies cc on cc.id = s.company_id join organizations o on o.id = s.org_id where o.name = 'TSK Demo Tokyo' order by s.id limit 1");
  const [jo] = await ownerQuery<{ title: string }>("select title from job_orders where site_id = $1 limit 1", [site.id]);
  ids = { ...ids, staffA: u.a, tsk: u.tsk, site: site.id };
  hidden = [site.site, site.company, ...(jo ? [jo.title] : []), CARD_NOTE];
  const name = `Uji Status LPK ${run}`;
  const [c] = await ownerQuery<{ id: string; org: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
     select o.id, $1, 'MALE', '2000-05-15', (select id from skill_fields where code = 'food'), 'READY', true from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id, organization_id::text as org`, [name]);
  worker = { id: c.id, name };
  ids.lpk = c.org;
  const [p] = await ownerQuery<{ id: string }>("insert into placements (candidate_id, org_id, site_id, start_date, status) values ($1, $2, $3, current_date - 60, 'ACTIVE') returning id::text as id", [worker.id, ids.tsk, ids.site]);
  await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $2, current_date, clock_timestamp())", [ids.tsk, ids.staffA, p.id]);
  const [card] = await ownerQuery<{ id: string }>("insert into residence_cards (organization_id, created_by, candidate_id, skill_field_id, expiry_date, period_months, note) values ($1, $2, $3, (select id from skill_fields where code = 'food'), $4::date, 12, $5) returning id::text as id", [ids.tsk, ids.staffA, worker.id, d(100), CARD_NOTE]);
  ids.card = card.id;
});

test.afterAll(async () => {
  await ownerQuery("update partnerships set active = true where lpk_id = $1 and tsk_id = $2", [ids.lpk, ids.tsk]);
  await ownerQuery("delete from residence_cards where candidate_id = $1", [worker.id]);
  await ownerQuery("delete from responsible_assignments where created_at >= $1", [startedAt]);
  await ownerQuery("delete from candidates where id = $1", [worker.id]);
});

async function pageFor(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}
const lpkUrl = () => `/candidates/${worker.id}`;
const status = (p: Page) => p.getByTestId("section-worker-status");

test("TSK 担当 mengisi tanggal tiba (masa depan ditolak server, tersimpan, audit hanya nama kolom); staf lain baca-saja", async ({ browser }) => {
  const page = await pageFor(browser, "tsk.staff@hashi.test");
  await page.goto(`/records/workers/${worker.id}`);
  const sec = page.getByTestId("arrival-section");
  await expect(sec).toHaveAttribute("data-can-edit", "true");
  await expect(page.getByTestId("arrival-value")).toHaveText("—");
  const input = page.getByTestId("arrival-date");
  await input.evaluate((e) => e.removeAttribute("max")); // lewati batas peramban supaya yang menolak SERVER
  await input.fill(d(3));
  await page.getByTestId("arrival-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("form-error").first()).toContainText("masa depan");
  expect(await ownerQuery("select 1 from placements where candidate_id = $1 and arrived_on is not null", [worker.id])).toHaveLength(0);
  await input.fill(d(-20));
  await page.getByTestId("arrival-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("arrival-value")).toHaveText(d(-20).replace(/-/g, "/"));
  const log = await ownerQuery<{ after: Record<string, unknown> }>("select after from audit_logs where action = 'placement.arrival_update' and entity_id = $1 and created_at >= $2", [worker.id, startedAt]);
  expect(log).toHaveLength(1);
  expect(log[0].after).toEqual({ fields: ["arrivedOn"] });
  expect(JSON.stringify(log)).not.toContain(d(-20));
  await page.context().close();

  const other = await pageFor(browser, "tsk.staff2@hashi.test");
  await other.goto(`/records/workers/${worker.id}`);
  await expect(other.getByTestId("arrival-section")).toHaveAttribute("data-can-edit", "false");
  await expect(other.getByTestId("arrival-readonly")).toBeVisible();
  await expect(other.getByTestId("arrival-value")).toHaveText(d(-20).replace(/-/g, "/"));
  await other.context().close();
});

test("LPK_ADMIN pemilik melihat tanggal tiba + status visa + berlaku sampai, dan HTML TIDAK memuat klien/lokasi/job order/catatan kartu", async ({ browser }) => {
  const page = await pageFor(browser, "lpk1.admin@hashi.test");
  await page.goto(lpkUrl());
  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveAttribute("data-visa", "valid");
  await expect(page.getByTestId("worker-arrived")).not.toHaveText("");
  await expect(page.getByTestId("worker-arrived")).toContainText(String(new Date(`${d(-20)}T00:00:00Z`).getUTCFullYear()));
  await expect(page.getByTestId("worker-visa")).toContainText("Berlaku");
  await expect(page.getByTestId("worker-valid-until")).toContainText(String(new Date(`${d(100)}T00:00:00Z`).getUTCFullYear()));
  const html = await page.content();
  for (const h of hidden) expect(html, `HTML LPK memuat: ${h}`).not.toContain(h);
  for (const section of ["section-placement", "card-section", "jp-profile", "arrival-section"]) await expect(page.getByTestId(section)).toHaveCount(0);
  await page.context().close();
});

test("status visa mengikuti kartu: diajukan = Sedang diperpanjang; lewat tanpa pengajuan = Sudah habis; tanpa kartu = Belum ada data", async ({ browser }) => {
  const page = await pageFor(browser, "lpk1.admin@hashi.test");
  await ownerQuery("update residence_cards set renewal_status = 'applied', applied_on = current_date - 3 where id = $1", [ids.card]);
  await page.goto(lpkUrl());
  await expect(status(page)).toHaveAttribute("data-visa", "renewing");
  await expect(page.getByTestId("worker-visa")).toContainText("Sedang diperpanjang");
  await ownerQuery("update residence_cards set renewal_status = 'not_started', applied_on = null, expiry_date = current_date - 4 where id = $1", [ids.card]);
  await page.reload();
  await expect(status(page)).toHaveAttribute("data-visa", "expired");
  await expect(page.getByTestId("worker-visa")).toContainText("Sudah habis");
  await ownerQuery("update residence_cards set status = 'void', void_reason = 'uji' where id = $1", [ids.card]);
  await page.reload();
  await expect(status(page)).toHaveAttribute("data-visa", "none");
  await expect(page.getByTestId("worker-visa")).toContainText("Belum ada data");
  await expect(page.getByTestId("worker-valid-until")).toHaveText("—");
  await page.context().close();
});

test("sensei LPK tidak melihat bagiannya (tidak dirender, datanya tidak dibaca); LPK lain 404; kemitraan nonaktif dan kandidat tidak dibagikan menyembunyikannya", async ({ browser }) => {
  const sensei = await pageFor(browser, "lpk1.sensei@hashi.test");
  await sensei.goto(lpkUrl());
  await expect(sensei.getByTestId("section-worker-status")).toHaveCount(0);
  const html = await sensei.content();
  for (const h of [...hidden, "worker-arrived"]) expect(html).not.toContain(h); // label statis ("Setelah berangkat") ada di katalog terjemahan semua peran; yang tidak boleh bocor = DATA
  await sensei.context().close();

  const other = await pageFor(browser, "lpk2.admin@hashi.test");
  expect((await other.request.get(lpkUrl())).status()).toBe(404);
  await other.context().close();

  const lpk = await pageFor(browser, "lpk1.admin@hashi.test");
  await lpk.goto(lpkUrl());
  await expect(status(lpk)).toBeVisible(); // masih ada: pekerja belum ditolak (kartu batal = Belum ada data)
  await ownerQuery("update partnerships set active = false where lpk_id = $1 and tsk_id = $2", [ids.lpk, ids.tsk]);
  await lpk.reload();
  await expect(status(lpk)).toHaveCount(0);
  await ownerQuery("update partnerships set active = true where lpk_id = $1 and tsk_id = $2", [ids.lpk, ids.tsk]);
  await ownerQuery("update candidates set shared_with_tsk = false where id = $1", [worker.id]);
  await lpk.reload();
  await expect(status(lpk)).toHaveCount(0);
  await ownerQuery("update candidates set shared_with_tsk = true where id = $1", [worker.id]);
  await lpk.reload();
  await expect(status(lpk)).toBeVisible();
  await lpk.context().close();
});

test("TSK tidak melihat bagian 'Setelah berangkat' milik LPK di detail kandidat (itu hanya untuk LPK_ADMIN)", async ({ browser }) => {
  const tsk = await pageFor(browser, "tsk.admin@hashi.test");
  await tsk.goto(lpkUrl());
  await expect(tsk.getByTestId("section-worker-status")).toHaveCount(0);
  await tsk.context().close();
});
