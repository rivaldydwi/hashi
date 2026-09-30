import { expect, test } from "@playwright/test";
import { login, ownerQuery } from "./helpers";

// Persetujuan berbagi data: Admin LPK mengubah dan mencabutnya; mencabut membuat kandidat langsung
// hilang dari TSK. Memakai kandidat demo "Budi Hidayat" (LPK Bandung) dan mengembalikan tanggalnya di akhir.

test.describe.configure({ mode: "serial" });

const startedAt = new Date();
let cid = "";
let original = "";
let url = "";

test.beforeAll(async () => {
  const [c] = await ownerQuery<{ id: string; d: string }>(
    "select c.id, to_char(c.data_consent_date, 'YYYY-MM-DD') as d from candidates c join organizations o on o.id = c.organization_id where c.full_name = 'Budi Hidayat' and o.name = 'LPK Demo Bandung'",
  );
  cid = c.id;
  original = c.d;
  url = `/candidates/${cid}`;
  expect(original).toBeTruthy();
});

test.afterAll(async () => {
  await ownerQuery("update candidates set data_consent_date = $2 where id = $1", [cid, original]);
});

const tskSees = async (page: import("@playwright/test").Page) => {
  await page.goto("/candidates?q=Budi");
  return Number((await page.getByTestId("candidate-total").textContent())!.trim());
};

test("sebelum dicabut: TSK melihat kandidat", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  expect(await tskSees(page)).toBe(1);
});

test("admin LPK mencabut persetujuan: ada peringatan jelas, lalu kandidat hilang dari TSK", async ({ page, browser }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await expect(page.getByTestId("consent-missing")).toHaveCount(0);

  await page.locator("[data-testid=consent-form] details > summary").click();
  const warning = page.locator("[data-testid=consent-revoke-form] p[role=alert]");
  await expect(warning).toContainText("TSK langsung tidak bisa lagi melihat kandidat ini");
  await expect(warning).toContainText("catatan, dan keputusan TSK");
  await page.getByRole("button", { name: "Ya, cabut persetujuan" }).click();
  // form pencabutan hilang (tidak ada yang bisa dicabut lagi); banner di bawah menjadi umpan baliknya
  await expect(page.getByTestId("consent-missing")).toContainText("tidak terlihat oleh TSK mana pun");
  await expect(page.getByTestId("value-consent")).toHaveText("Belum ada persetujuan");

  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  expect(await tskSees(tsk)).toBe(0); // langsung hilang dari daftar
  const res = await tsk.goto(url);
  expect(res?.status()).toBe(404); // dan halaman detailnya pun tidak ada bagi TSK

  const [row] = await ownerQuery<{ data_consent_date: string | null }>("select data_consent_date from candidates where id = $1", [cid]);
  expect(row.data_consent_date).toBeNull();
  const [log] = await ownerQuery<{ organization_id: string; actor_org_id: string; before: { dataConsentDate: string }; after: { dataConsentDate: string | null } }>(
    "select organization_id, actor_org_id, before, after from audit_logs where candidate_id = $1 and action = 'candidate.consent_revoke' and created_at >= $2",
    [cid, startedAt],
  );
  expect(log.before.dataConsentDate).toBe(original);
  expect(log.after.dataConsentDate).toBeNull();
  expect(log.organization_id).toBe(log.actor_org_id); // pelaku = LPK pemilik
});

test("mengisi kembali tanggal persetujuan: kandidat terlihat lagi; tanggal dalam format lokal id dan ja", async ({ page, browser }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await page.locator("#consent-date").fill("2026-03-05");
  await page.locator("[data-testid=consent-form] form").first().getByRole("button", { name: "Simpan tanggal" }).click();
  await expect(page.getByTestId("value-consent")).toHaveText("5 Maret 2026");

  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test"); // antarmuka bahasa Jepang
  expect(await tskSees(tsk)).toBe(1);
  await tsk.goto(url);
  await expect(tsk.getByTestId("value-consent")).toHaveText("2026年3月5日");

  const [log] = await ownerQuery<{ before: { dataConsentDate: string | null }; after: { dataConsentDate: string } }>(
    "select before, after from audit_logs where candidate_id = $1 and action = 'candidate.consent_change' and created_at >= $2",
    [cid, startedAt],
  );
  expect(log.before.dataConsentDate).toBeNull();
  expect(log.after.dataConsentDate).toBe("2026-03-05");
});

test("tanggal persetujuan di masa depan ditolak", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await page.locator("#consent-date").evaluate((el, v) => {
    el.removeAttribute("max");
    (el as HTMLInputElement).value = v;
  }, future);
  await page.locator("[data-testid=consent-form] form").first().getByRole("button", { name: "Simpan tanggal" }).click();
  await expect(page.locator("[data-testid=consent-form] p[role=alert]").first()).toHaveText("Tanggal persetujuan tidak boleh di masa depan.");
});
