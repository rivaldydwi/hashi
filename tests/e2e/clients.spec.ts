import { expect, test, type Page } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Klien (langkah 5, bagian B): perusahaan, lokasi, PIC. Hanya menyentuh data buatan tes ini (nama berisi run).

test.describe.configure({ mode: "serial" });

const run = unique();
const COMPANY = `株式会社テスト${run}`;
const SITE = `テスト施設${run}`;
const SITE2 = `第二事業所${run}`;
const PIC_NAME = `担当者ひみつ${run}`;
const PIC_PHONE = `090-0000-${String(run).slice(-4)}`;
const startedAt = new Date();
let companyId = "";
let siteId = "";

test.afterAll(async () => {
  await ownerQuery("delete from client_companies where name = $1", [COMPANY]);
});

const idsFromUrl = (url: string) => url.match(/clients\/([0-9a-f-]{36})(?:\/sites\/([0-9a-f-]{36}))?/)!;

test("staf TSK menambah perusahaan, lokasi dengan bidang, dan dua PIC; nomor badan hukum divalidasi", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.getByRole("link", { name: "Klien" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.getByTestId("company-add").click();

  await page.locator("#company-name").fill(COMPANY);
  await page.locator("#company-corporateNumber").fill("12345");
  await page.getByTestId("client-submit").click();
  await expect(page.locator("form p[role=alert]")).toContainText("13 digit");
  await expect(page.locator("#company-name")).toHaveValue(COMPANY); // isian tidak hilang
  await page.locator("#company-corporateNumber").fill("1234567890123");
  await page.locator("#company-phone").fill("03-0000-0000");
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  companyId = idsFromUrl(page.url())[1];

  await page.getByTestId("site-add").click();
  await page.locator("#site-name").fill(SITE);
  await page.locator("#site-address").fill("東京都千代田区ダミー1-1-1");
  await page.locator("input[name=fieldIds][data-code=kaigo]").check();
  await page.locator("input[name=fieldIds][data-code=food]").check();
  await page.getByTestId("client-submit").click();
  await page.waitForURL(/\/sites\/[0-9a-f-]{36}$/);
  siteId = idsFromUrl(page.url())[2];
  await expect(page.getByTestId("site-field-chips")).toContainText("Perawatan lansia (kaigo)");
  await expect(page.getByTestId("site-field-chips")).toContainText("Pengolahan makanan & minuman");

  // PIC 1 dan 2
  await page.locator("#contact-roleTitle").fill("施設長");
  await page.locator("#contact-name").fill(PIC_NAME);
  await page.locator("#contact-phone").fill(PIC_PHONE);
  await page.getByTestId("form-contact-add").getByTestId("client-submit").click();
  await expect(page.getByTestId("contact")).toHaveCount(1);
  await page.getByTestId("contact-add-toggle").click();
  await page.locator("#contact-roleTitle").fill("管理者");
  await page.locator("#contact-name").fill("もう一人");
  await page.getByTestId("form-contact-add").getByTestId("client-submit").click();
  await expect(page.getByTestId("contact")).toHaveCount(2);

  // Ubah bidang lokasi: lepas food
  await page.locator("input[name=fieldIds][data-code=food]").uncheck();
  await page.getByTestId("form-site-edit").getByTestId("client-submit").click();
  await expect(page.getByTestId("site-field-chips")).not.toContainText("Pengolahan makanan");
  await expect(page.getByTestId("site-field-chips")).toContainText("kaigo");
});

test("daftar menampilkan perusahaan dengan lokasi dan bidang; pencarian; nonaktif disembunyikan", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  await page.goto("/clients");
  const card = page.getByTestId("company-card").filter({ hasText: COMPANY });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("site-row")).toContainText(SITE);
  await expect(card).toContainText("Perawatan lansia (kaigo)");

  await page.goto(`/clients?q=${encodeURIComponent(SITE)}`); // cari lewat nama lokasi
  await expect(page.getByTestId("company-card").filter({ hasText: COMPANY })).toHaveCount(1);
  await page.goto("/clients?q=tidak-ada-yang-cocok-xyz");
  await expect(page.getByTestId("client-empty")).toBeVisible();

  // Staf boleh menonaktifkan, tetapi tidak melihat tombol hapus permanen
  await page.goto(`/clients/${companyId}`);
  await expect(page.getByTestId("delete-company")).toHaveCount(0);
  await page.getByTestId("toggle-company-button").click();
  await expect(page.getByText("Dinonaktifkan.")).toBeVisible();
  await page.goto(`/clients?q=${encodeURIComponent(COMPANY)}`);
  await expect(page.getByTestId("company-card")).toHaveCount(0);
  await page.goto(`/clients?q=${encodeURIComponent(COMPANY)}&inactive=1`);
  await expect(page.getByTestId("company-card")).toHaveCount(1);
  await page.goto(`/clients/${companyId}`);
  await page.getByTestId("toggle-company-button").click();
  await expect(page.getByText("Diaktifkan.")).toBeVisible();
});

test("LPK (admin dan sensei) tidak melihat menu Klien dan URL langsungnya 404; super admin tidak punya akses", async ({ page, browser }) => {
  for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test", "admin@hashi.test"]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, email);
    await expect(p.getByRole("link", { name: "Klien", exact: true })).toHaveCount(0);
    for (const path of ["/clients", `/clients/${companyId}`, `/clients/${companyId}/sites/${siteId}`, "/clients/new"]) {
      const res = await p.goto(path);
      expect(res?.status(), `${email} ${path}`).toBe(404);
    }
    await ctx.close();
  }
  void page;
});

test("hapus permanen: staf ditolak walau memanggil action langsung; Admin TSK bisa dan semua turunan ikut hilang; audit tanpa PIC", async ({ page, browser }) => {
  // Admin TSK (tampilan Jepang): ambil field form hapus perusahaan sebagai bahan pemanggilan langsung
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, "tsk.admin@hashi.test");
  await admin.goto(`/clients/${companyId}`);
  await expect(admin.getByTestId("delete-company")).toHaveCount(1);
  const fields = await admin.locator("[data-testid=delete-company] form input[type=hidden]").evaluateAll((els) => els.map((e) => [(e as HTMLInputElement).name, (e as HTMLInputElement).value] as [string, string]));
  await admin.locator("[data-testid=delete-company] summary").click();

  await login(page, "tsk.staff@hashi.test");
  const res = await page.request.post(`/clients/${companyId}`, { multipart: Object.fromEntries(fields) });
  expect(await res.text()).toContain("Hanya Admin TSK");
  expect(await ownerQuery("select 1 from client_companies where id = $1", [companyId])).toHaveLength(1);

  // Admin TSK: hapus
  await admin.getByTestId("delete-company-confirm").click();
  await expect(admin).toHaveURL(/\/clients\?deleted=1/);
  await expect(admin.getByTestId("client-deleted")).toBeVisible();
  for (const t of ["client_companies", "client_sites", "client_site_contacts", "client_site_fields"]) {
    const col = t === "client_companies" ? "id" : t === "client_sites" ? "company_id" : "site_id";
    const val = t === "client_site_contacts" || t === "client_site_fields" ? siteId : companyId;
    expect(await ownerQuery(`select 1 from ${t} where ${col} = $1`, [val]), t).toHaveLength(0);
  }
  await adminCtx.close();

  const audit = JSON.stringify(await ownerQuery("select action, entity, after from audit_logs where created_at >= $1 and action like 'client_%'", [startedAt]));
  expect(audit).toContain("client_company.create");
  expect(audit).toContain("client_contact.create");
  expect(audit).toContain("client_company.delete");
  for (const secret of [PIC_NAME, PIC_PHONE, COMPANY, SITE]) expect(audit).not.toContain(secret);
});
