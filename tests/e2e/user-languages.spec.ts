import { expect, test, type Page } from "@playwright/test";
import { createIsolatedLpk, login, ownerQuery, unique } from "./helpers";

// Bahasa yang DIKUASAI pengguna (users.languages) terpisah dari bahasa TAMPILAN (users.locale).
// Memakai LPK baru sendiri, jadi data seed tidak berubah.

test.describe.configure({ mode: "serial" });

const run = unique();
const startedAt = new Date();
let admin = { orgName: "", adminEmail: "", adminPassword: "" };
const emailBoth = `bhs-dua-${run}@hashi.test`;
const emailEn = `bhs-en-${run}@hashi.test`;
const emailJa = `bhs-ja-${run}@hashi.test`;

const row = (page: Page, email: string) => page.getByTestId("user-table").locator("tr", { hasText: email });
const langsOf = async (page: Page, email: string) =>
  (await row(page, email).locator("[data-lang]").evaluateAll((els) => els.map((e) => e.getAttribute("data-lang")))).sort();

async function addUser(page: Page, email: string, langs: string[]) {
  await page.goto("/users/new");
  await page.locator("#name").fill(`Uji ${email.slice(0, 8)}`);
  await page.locator("#email").fill(email);
  await page.locator("#role").selectOption("LPK_SENSEI");
  for (const l of ["id", "ja", "en"]) await page.locator(`#languages-${l}`).setChecked(langs.includes(l));
  await page.locator("main form button[type=submit]").click();
}

test.beforeAll(async ({ browser }) => {
  admin = await createIsolatedLpk(browser);
});

test("buat pengguna dengan dua bahasa: daftar menampilkan keduanya; bahasa tampilan awal mengikuti aturan", async ({ page }) => {
  await login(page, admin.adminEmail, admin.adminPassword);
  await addUser(page, emailBoth, ["ja", "id"]);
  await expect(page.getByTestId("temp-password-value")).toBeVisible();
  await addUser(page, emailEn, ["en"]);
  await expect(page.getByTestId("temp-password-value")).toBeVisible();
  await addUser(page, emailJa, ["ja", "en"]);
  await expect(page.getByTestId("temp-password-value")).toBeVisible();

  await page.goto("/users");
  expect(await langsOf(page, emailBoth)).toEqual(["id", "ja"]);
  await expect(row(page, emailBoth)).toContainText("Indonesia");
  await expect(row(page, emailBoth)).toContainText("Jepang");
  expect(await langsOf(page, emailEn)).toEqual(["en"]);

  // locale awal: id bila ada id; kalau tidak ja bila ada ja; kalau tidak id
  const rows = await ownerQuery<{ email: string; locale: string }>("select email, locale::text from users where email = any($1)", [[emailBoth, emailEn, emailJa]]);
  const loc = Object.fromEntries(rows.map((r) => [r.email, r.locale]));
  expect(loc).toEqual({ [emailBoth]: "id", [emailEn]: "id", [emailJa]: "ja" });
});

test("regresi: ganti bahasa tampilan ke Jepang dan kembali tidak mengubah kolom Bahasa", async ({ page }) => {
  await login(page, admin.adminEmail, admin.adminPassword);
  await page.goto("/users");
  const before = { me: await langsOf(page, admin.adminEmail), both: await langsOf(page, emailBoth), en: await langsOf(page, emailEn) };
  expect(before.me).toEqual(["id"]);

  await page.getByRole("button", { name: "日本語" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.goto("/users");
  // Label berubah ke bahasa Jepang, himpunannya tidak
  await expect(row(page, emailBoth)).toContainText("インドネシア語");
  await expect(row(page, emailBoth)).toContainText("日本語");
  expect({ me: await langsOf(page, admin.adminEmail), both: await langsOf(page, emailBoth), en: await langsOf(page, emailEn) }).toEqual(before);
  const [me] = await ownerQuery<{ locale: string; languages: string }>("select locale::text, languages::text from users where email = $1", [admin.adminEmail]);
  expect(me.locale).toBe("ja"); // preferensi tampilan memang berubah...
  expect(me.languages).toBe("{id}"); // ...tetapi bahasa yang dikuasai tidak

  await page.getByRole("button", { name: "Indonesia", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await page.goto("/users");
  expect({ me: await langsOf(page, admin.adminEmail), both: await langsOf(page, emailBoth), en: await langsOf(page, emailEn) }).toEqual(before);
  await expect(row(page, emailBoth)).toContainText("Indonesia");
});

test("form tanpa centang ditolak (tambah dan ubah); ubah languages lewat form ubah; audit hanya nama kolom", async ({ page }) => {
  await login(page, admin.adminEmail, admin.adminPassword);
  // Tambah tanpa centang
  await addUser(page, `bhs-kosong-${run}@hashi.test`, []);
  await expect(page.locator("p[role=alert]")).toHaveText("Pilih minimal satu bahasa yang dikuasai.");
  expect(await ownerQuery("select 1 from users where email = $1", [`bhs-kosong-${run}@hashi.test`])).toHaveLength(0);

  // Ubah: kosongkan semua -> ditolak, data tetap
  await page.goto("/users");
  await row(page, emailBoth).getByRole("link", { name: "Ubah" }).click();
  for (const l of ["id", "ja", "en"]) await page.locator(`#languages-${l}`).setChecked(false);
  await page.locator("form:has(#languages-id) button[type=submit]").click();
  await expect(page.locator("form:has(#languages-id) p[role=alert]")).toHaveText("Pilih minimal satu bahasa yang dikuasai.");
  expect((await ownerQuery<{ l: string }>("select languages::text l from users where email = $1", [emailBoth]))[0].l).toBe("{id,ja}");

  // Ubah: id, ja, en
  await page.locator("#languages-id").setChecked(true);
  await page.locator("#languages-ja").setChecked(true);
  await page.locator("#languages-en").setChecked(true);
  await page.locator("form:has(#languages-id) button[type=submit]").click();
  await expect(page.locator("form:has(#languages-id) p[role=status]")).toBeVisible();
  await page.goto("/users");
  expect(await langsOf(page, emailBoth)).toEqual(["en", "id", "ja"]);

  const audit = await ownerQuery<{ after: { changed?: string[] }; before: Record<string, unknown> }>(
    "select before, after from audit_logs a join users u on u.id::text = a.entity_id where a.action = 'user.update' and u.email = $1 and a.created_at >= $2",
    [emailBoth, startedAt],
  );
  expect(audit.length).toBeGreaterThanOrEqual(1);
  expect(audit.some((a) => a.after.changed?.includes("languages"))).toBe(true);
  // languages ada di AUDIT_VALUE_FIELDS.user: nilai sebelum/sesudah tercatat; nama/email pengguna tidak
  const last = audit.find((a) => a.after.changed?.includes("languages")) as unknown as { before: { languages: string[] }; after: { languages: string[] } };
  expect([...last.after.languages].sort()).toEqual(["en", "id", "ja"]);
  expect(last.before.languages).not.toContain("en");
  expect(JSON.stringify(audit)).not.toContain(emailBoth);
});

test("super admin melihat chip bahasa di kelola organisasi, dan halaman Akun menampilkannya", async ({ page }) => {
  await login(page, "admin@hashi.test");
  const [org] = await ownerQuery<{ id: string }>("select id from organizations where name = $1", [admin.orgName]);
  await page.goto(`/admin/organizations/${org.id}`);
  expect(await langsOf(page, emailBoth)).toEqual(["en", "id", "ja"]);
  await page.context().clearCookies();
  await login(page, "tsk.admin@hashi.test");
  await page.goto("/account");
  expect((await page.locator("[data-testid=user-languages] [data-lang]").evaluateAll((e) => e.map((x) => x.getAttribute("data-lang")))).sort()).toEqual(["en", "id", "ja"]);
});
