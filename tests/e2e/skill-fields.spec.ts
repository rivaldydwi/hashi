import { expect, test } from "@playwright/test";
import { login, ownerQuery, unique } from "./helpers";

// Master bidang kerja (langkah 5, bagian A). Hanya menyentuh bidang buatan tes ini (kode `uji-<run>`).

test.describe.configure({ mode: "serial" });

const run = unique();
const CODE = `uji-${run}`;
const NAME_ID = `Logistik Uji ${run}`;
const NAME_JA = `物流${run}`;

test.afterAll(async () => {
  await ownerQuery("delete from skill_fields where code = $1", [CODE]);
});

const row = (page: import("@playwright/test").Page, code: string) => page.locator(`[data-testid=skill-field-row][data-code=${code}]`);

test("super admin menambah bidang; label mengikuti bahasa; bidang yang sudah dipakai tidak bisa dihapus", async ({ page }) => {
  await login(page, "admin@hashi.test");
  await page.getByRole("link", { name: "Bidang kerja" }).click();
  await expect(page).toHaveURL(/\/admin\/skill-fields/);
  await expect(row(page, "kaigo").locator("input[name=nameId]")).toHaveValue("Perawatan lansia (kaigo)");

  await page.locator("#sf-code").fill(CODE);
  await page.locator("#sf-name-id").fill(NAME_ID);
  await page.locator("#sf-name-ja").fill(NAME_JA);
  await page.getByTestId("form-skill-field-create").getByRole("button", { name: "Tambah bidang" }).click();
  await expect(row(page, CODE)).toBeVisible();

  // Kode ganda ditolak
  await page.locator("#sf-code").fill(CODE);
  await page.locator("#sf-name-id").fill("Lain");
  await page.locator("#sf-name-ja").fill("別");
  await page.getByTestId("form-skill-field-create").getByRole("button", { name: "Tambah bidang" }).click();
  await expect(page.getByTestId("form-skill-field-create").getByRole("alert")).toContainText("sudah dipakai");

  // Bidang yang dipakai kandidat: hapus ditolak (FK), tetap ada
  await row(page, "kaigo").getByRole("button", { name: "Hapus" }).click();
  await expect(row(page, "kaigo").getByRole("alert")).toContainText("tidak bisa dihapus");
  await expect(row(page, "kaigo")).toBeVisible();
  expect(await ownerQuery("select 1 from skill_fields where code = 'kaigo'")).toHaveLength(1);
});

test("bidang aktif muncul di form kandidat dan filter; label Jepang untuk UI Jepang; nonaktif menghilang dari pilihan baru", async ({ page, browser }) => {
  const lpk = page.context();
  void lpk;
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates/new");
  await expect(page.locator("#basic-fieldId option", { hasText: NAME_ID })).toHaveCount(1);
  await page.goto("/candidates");
  await expect(page.locator("#field option", { hasText: NAME_ID })).toHaveCount(1);

  const ctx = await browser.newContext();
  const tsk = await ctx.newPage();
  await login(tsk, "tsk.admin@hashi.test"); // tampilan Jepang
  await tsk.goto("/candidates");
  await expect(tsk.locator("#field option", { hasText: NAME_JA })).toHaveCount(1);
  await expect(tsk.locator("#field option", { hasText: "介護" })).toHaveCount(1);
  await ctx.close();

  const admin = await browser.newContext();
  const sa = await admin.newPage();
  await login(sa, "admin@hashi.test");
  await sa.goto("/admin/skill-fields");
  await row(sa, CODE).getByRole("button", { name: "Nonaktifkan" }).click();
  await expect(row(sa, CODE)).toContainText("Nonaktif");
  await admin.close();

  await page.goto("/candidates/new");
  await expect(page.locator("#basic-fieldId option", { hasText: NAME_ID })).toHaveCount(0);
  await page.goto("/candidates");
  await expect(page.locator("#field option", { hasText: NAME_ID })).toHaveCount(0);
});

test("bidang yang belum dipakai bisa dihapus; peran lain tidak punya akses halaman master", async ({ page, browser }) => {
  await login(page, "admin@hashi.test");
  await page.goto("/admin/skill-fields");
  await row(page, CODE).getByRole("button", { name: "Hapus" }).click();
  await expect(row(page, CODE)).toHaveCount(0);
  expect(await ownerQuery("select 1 from skill_fields where code = $1", [CODE])).toHaveLength(0);

  for (const email of ["lpk1.admin@hashi.test", "tsk.admin@hashi.test"]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, email);
    await p.goto("/admin/skill-fields");
    await expect(p.getByTestId("skill-field-table")).toHaveCount(0);
    await expect(p).not.toHaveURL(/skill-fields/);
    await ctx.close();
  }
});
