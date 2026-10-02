import { expect, test, type Page } from "@playwright/test";
import { createScratchCandidate, deleteScratchCandidate, login, ownerQuery, unique } from "./helpers";

// Job order (langkah 5, bagian C): dibuat lewat UI oleh staf TSK; kandidat cocok, ajukan, terisi otomatis, penempatan, dan
// isolasi dari LPK. Hanya menyentuh data buatan tes ini (nama berisi run).

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date();
const COMPANY = `株式会社UJO${run}`;
const SITE = `UJO工場${run}`;
const TITLE = `UJO求人${run}`;
const NAMES = { a: `Uji Cocok A ${run}`, b: `Uji Cocok B ${run}`, c: `Uji Cocok C ${run}` };
const ids: Record<string, string> = {};
let joId = "";
let companyId = "";

test.beforeAll(async () => {
  // A: N3 + nilai bulanan 4.5 (terbaik); B: N5 + nilai 3.0 (JLPT di bawah syarat); C: perempuan, belum dinilai (gender di luar syarat)
  ids.a = (await createScratchCandidate({ name: NAMES.a, gender: "MALE" })).id;
  ids.b = (await createScratchCandidate({ name: NAMES.b, gender: "MALE" })).id;
  ids.c = (await createScratchCandidate({ name: NAMES.c, gender: "FEMALE" })).id;
  await ownerQuery("insert into candidate_certificates (candidate_id, type, level_or_field) values ($1, 'JLPT', 'N3'), ($2, 'JLPT', 'N5')", [ids.a, ids.b]);
  await ownerQuery("insert into candidate_certificates (candidate_id, type, level_or_field, score) values ($1, 'JFT_BASIC', 'A2', 210)", [ids.a]);
  for (const [cid, score] of [[ids.a, 5], [ids.b, 3]] as const) {
    await ownerQuery(
      "with s as (select set_config('app.user_id', u.id::text, true) from users u where u.email = 'lpk1.admin@hashi.test') insert into candidate_assessments (candidate_id, org_id, kind, assessed_on, score_japanese, score_attitude, score_fitness, score_motivation) select c.id, c.organization_id, 'LPK_MONTHLY', current_date - 10, $2, $2, $3, $3 from candidates c, s where c.id = $1",
      [cid, score, score === 5 ? 4 : 3],
    );
  }
});

test.afterAll(async () => {
  // Kandidat DEPARTED dijaga trigger hapus: lepas seleksi dan penempatannya dulu (sebagai owner), baru hapus kandidat uji
  const list = Object.values(ids);
  await ownerQuery("delete from placements where candidate_id = any($1::uuid[])", [list]);
  await ownerQuery("delete from candidate_selections where candidate_id = any($1::uuid[])", [list]);
  for (const id of list) await deleteScratchCandidate(id);
  await ownerQuery("delete from job_orders where site_id in (select s.id from client_sites s join client_companies c on c.id = s.company_id where c.name = $1)", [COMPANY]);
  await ownerQuery("delete from client_companies where name = $1", [COMPANY]);
});

async function openMatch(page: Page) {
  await page.goto(`/job-orders/${joId}?tab=match`);
  await expect(page.getByTestId("match-table")).toBeVisible();
}
const row = (page: Page, name: string) => page.locator(`[data-testid=match-row][data-candidate="${name}"]`);

test("staf TSK menambah perusahaan, lokasi dengan PIC dan bidang, lalu job order lewat UI", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto("/clients/new");
  await page.locator("#company-name").fill(COMPANY);
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  companyId = page.url().split("/clients/")[1];
  await page.getByTestId("site-add").click();
  await page.locator("#site-name").fill(SITE);
  await page.locator("input[name=fieldIds][data-code=food]").check();
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/sites\/[0-9a-f-]{36}$/);
  await page.locator("#contact-roleTitle").fill("工場長");
  await page.locator("#contact-name").fill("ダミー担当");
  await page.getByTestId("form-contact-add").getByTestId("client-submit").click();
  await expect(page.getByTestId("contact")).toHaveCount(1);

  await page.locator('[data-testid=sidebar] a[href="/job-orders"]').click();
  await page.getByTestId("primary-action").click();
  await page.locator(`[data-testid=site-option]:has-text("${SITE}") [data-testid=site-choose]`).click();
  // Bidang hanya yang diterima lokasi (food)
  await expect(page.locator("#jo-fieldId option:not([value=''])")).toHaveCount(1);
  await page.locator("#jo-title").fill(TITLE);
  await page.locator("#jo-fieldId").selectOption({ label: "Pengolahan makanan & minuman" });
  await page.locator("#jo-positions").fill("1");
  await page.locator("#jo-minJlpt").selectOption("N4");
  await page.locator("#jo-genderRequirement").selectOption("MALE");
  await page.locator("#jo-jftRequired").check();
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/job-orders\/[0-9a-f-]{36}$/);
  joId = page.url().split("/job-orders/")[1];
  await expect(page.getByTestId("job-order-status")).toContainText("Terbuka");
  await expect(page.getByTestId("job-order-status")).toContainText("0 / 1");
});

test("tab Kandidat cocok: urut menurut nilai terakhir, syarat hijau/merah (tidak menyembunyikan), Ajukan membuat seleksi dengan job order", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await openMatch(page);
  const names = await page.locator("[data-testid=match-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-candidate")));
  const mine = names.filter((n) => Object.values(NAMES).includes(n!));
  expect(mine).toEqual([NAMES.a, NAMES.b, NAMES.c]); // 4.5 > 3.0 > belum dinilai
  await expect(row(page, NAMES.a).getByTestId("match-avg")).toHaveText("4.5");
  // A memenuhi semua syarat
  for (const f of ["flag-jlpt", "flag-jft", "flag-gender"]) await expect(row(page, NAMES.a).getByTestId(f)).toHaveAttribute("data-ok", "true");
  // B: JLPT N5 < N4 (merah), tanpa JFT (merah), gender cocok (hijau); C: gender salah (merah)
  await expect(row(page, NAMES.b).getByTestId("flag-jlpt")).toHaveAttribute("data-ok", "false");
  await expect(row(page, NAMES.b).getByTestId("flag-jft")).toHaveAttribute("data-ok", "false");
  await expect(row(page, NAMES.b).getByTestId("flag-gender")).toHaveAttribute("data-ok", "true");
  await expect(row(page, NAMES.c).getByTestId("flag-gender")).toHaveAttribute("data-ok", "false");

  await row(page, NAMES.a).getByTestId("propose-button").click();
  await expect(row(page, NAMES.a).getByTestId("match-proposed")).toBeVisible();
  const sel = await ownerQuery<{ decision: string; job_order_id: string }>("select decision, job_order_id from candidate_selections where candidate_id = $1", [ids.a]);
  expect(sel).toEqual([{ decision: "SUBMITTED_TO_CLIENT", job_order_id: joId }]);

  // Sisi TSK di halaman kandidat: keputusan beserta job order dan lokasinya
  await page.goto(`/candidates/${ids.a}`);
  const selRow = page.locator("[data-testid=selection-row][data-scope=job-order]");
  await expect(selRow).toContainText(TITLE);
  await expect(selRow).toContainText(SITE);
  await expect(selRow).toHaveAttribute("data-decision", "SUBMITTED_TO_CLIENT");
});

test("terpilih (lulus interview client) mengisi job order otomatis; dibuka lagi manual; Berangkat membuat penempatan yang bisa diubah", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(`/candidates/${ids.a}`);
  await page.locator("#decision-job-order").selectOption(joId);
  await page.locator("#decision").selectOption("PASSED_CLIENT_INTERVIEW");
  await page.locator("[data-testid=form-decision] button[type=submit]").click();
  await expect(page.locator("[data-testid=selection-row][data-scope=job-order]")).toHaveAttribute("data-decision", "PASSED_CLIENT_INTERVIEW");

  await page.goto(`/job-orders/${joId}`);
  await expect(page.getByTestId("job-order-status")).toContainText("Terisi");
  await expect(page.getByTestId("job-order-status")).toContainText("1 / 1");
  await openMatch(page);
  await expect(page.locator("[data-testid=propose-button]").first()).toHaveCount(0); // tidak terbuka lagi: tidak ada tombol Ajukan

  await page.goto(`/job-orders/${joId}`);
  await page.getByTestId("status-OPEN-button").click();
  await expect(page.getByTestId("job-order-status")).toContainText("Terbuka");

  // Berangkat -> penempatan ACTIVE otomatis, tanggal mulai bisa diubah staf
  await page.goto(`/candidates/${ids.a}`);
  await page.locator("#decision-job-order").selectOption(joId);
  await page.locator("#decision").selectOption("DEPARTED");
  await page.locator("[data-testid=form-decision] button[type=submit]").click();
  await expect(page.locator("[data-testid=selection-row][data-scope=job-order]")).toHaveAttribute("data-decision", "DEPARTED");
  await expect(page.getByTestId("section-placement")).toBeVisible();
  await expect(page.getByTestId("placement")).toHaveAttribute("data-status", "ACTIVE");
  await page.locator("[data-testid=form-placement] input[type=date]").first().fill("2026-11-01");
  await page.locator("[data-testid=form-placement] [data-testid=client-submit]").click();
  await expect(page.locator("[data-testid=form-placement] p[role=status]")).toBeVisible();
  const [pl] = await ownerQuery<{ start_date: string; status: string; site_name: string }>("select p.start_date::text, p.status::text, s.name as site_name from placements p join client_sites s on s.id = p.site_id where p.candidate_id = $1", [ids.a]);
  expect(pl).toMatchObject({ start_date: "2026-11-01", status: "ACTIVE", site_name: SITE });
  // Sudah ditempatkan: tidak bisa diajukan lagi ke job order lain; di tab Kandidat cocok ditandai
  await page.goto(`/job-orders/${joId}?tab=match`);
  await expect(row(page, NAMES.a).getByTestId("match-placed")).toBeVisible();
});

test("LPK tidak melihat apa pun dari klien atau job order (menu, URL, dan HTML kandidat)", async ({ browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test"]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, email);
    await expect(p.getByRole("link", { name: "Job order", exact: true })).toHaveCount(0);
    for (const path of ["/job-orders", `/job-orders/${joId}`, "/job-orders/new", "/clients"]) {
      expect((await p.goto(path))?.status(), `${email} ${path}`).toBe(404);
    }
    const res = await p.goto(`/candidates/${ids.a}`);
    expect(res?.status()).toBe(200);
    const html = await (await p.request.get(`/candidates/${ids.a}`)).text();
    for (const secret of [TITLE, SITE, COMPANY, joId, "section-placement", "UJO"]) expect(html, `${email}: ${secret}`).not.toContain(secret);
    if (email.includes("admin")) {
      // Admin LPK melihat keputusan paling maju per TSK, tanpa job order
      await expect(p.getByTestId("decision-list")).toContainText("TSK Demo Tokyo");
    }
    await ctx.close();
  }
});

test("hapus job order: staf tidak melihat tombol; Admin TSK ditolak bila dirujuk seleksi/penempatan; audit tanpa judul dan catatan", async ({ page, browser }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto(`/job-orders/${joId}`);
  await expect(page.getByTestId("delete-job-order")).toHaveCount(0);

  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await login(admin, "tsk.admin@hashi.test");
  await admin.goto(`/job-orders/${joId}`);
  await admin.locator("[data-testid=delete-job-order] summary").click();
  await admin.getByTestId("delete-job-order-confirm").click();
  await expect(admin.locator("[data-testid=delete-job-order] p[role=alert]")).toContainText("削除できません"); // Admin TSK memakai tampilan Jepang
  expect(await ownerQuery("select 1 from job_orders where id = $1", [joId])).toHaveLength(1);
  await ctx.close();

  const audit = JSON.stringify(await ownerQuery("select action, entity, after from audit_logs where created_at >= $1 and (action like 'job_order.%' or action like 'selection.%' or action like 'placement.%')", [startedAt]));
  expect(audit).toContain("job_order.create");
  expect(audit).toContain("placement.update");
  expect(audit).not.toContain(TITLE);
  expect(audit).not.toContain("2026-11-01");
});
