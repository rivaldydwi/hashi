import { expect, test, type Page } from "@playwright/test";
import { login, ownerQuery } from "./helpers";

// Berbagi ke TSK (shared_with_tsk): satu-satunya gerbang visibilitas TSK, dipegang Admin LPK.
// Memakai kandidat demo "Budi Hidayat" (LPK Bandung, dibagikan) dan mengembalikan keadaannya di akhir.

test.describe.configure({ mode: "serial" });

const startedAt = new Date();
let cid = "";
let url = "";
let originalDate: string | null = null;

test.beforeAll(async () => {
  const [c] = await ownerQuery<{ id: string; shared: boolean; d: string | null }>(
    "select c.id, c.shared_with_tsk as shared, to_char(c.data_consent_date, 'YYYY-MM-DD') as d from candidates c join organizations o on o.id = c.organization_id where c.full_name = 'Budi Hidayat' and o.name = 'LPK Demo Bandung'",
  );
  cid = c.id;
  url = `/candidates/${cid}`;
  originalDate = c.d;
  expect(c.shared).toBe(true);
});

test.afterAll(async () => {
  await ownerQuery("update candidates set shared_with_tsk = true, data_consent_date = $2 where id = $1", [cid, originalDate]);
});

const tskSees = async (page: Page) => {
  await page.goto("/candidates?q=Budi");
  return Number((await page.getByTestId("candidate-total").textContent())!.trim());
};

test("dibagikan: TSK melihat kandidat; LPK melihat statusnya di daftar dan di halaman detail", async ({ page, browser }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/candidates?q=Budi");
  await expect(page.getByTestId("shared-cell")).toHaveText("Dibagikan");
  await page.goto(url);
  await expect(page.getByTestId("sharing-state")).toHaveText("Dibagikan ke TSK mitra");

  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  expect(await tskSees(tsk)).toBe(1);
});

test("mematikan: peringatan akibat jelas, lalu kandidat langsung hilang dari TSK (data tidak dihapus)", async ({ page, browser }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await page.locator("[data-testid=sharing-form] details > summary").click();
  const warning = page.locator("[data-testid=sharing-disable-form] p[role=alert]");
  await expect(warning).toContainText("TSK langsung tidak bisa lagi melihat kandidat ini");
  await expect(warning).toContainText("data, dokumen, catatan, dan keputusan TSK");
  await expect(warning).toContainText("tidak dihapus");
  await page.getByRole("button", { name: "Ya, hentikan berbagi" }).click();
  await expect(page.getByTestId("sharing-state")).toHaveText("Belum dibagikan");

  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  expect(await tskSees(tsk)).toBe(0);
  expect((await tsk.goto(url))?.status()).toBe(404);

  const [row] = await ownerQuery<{ shared_with_tsk: boolean; at: string | null; by: string | null }>(
    "select shared_with_tsk, shared_with_tsk_at as at, shared_with_tsk_by as by from candidates where id = $1", [cid]);
  expect(row).toEqual({ shared_with_tsk: false, at: null, by: null });
  const [log] = await ownerQuery<{ organization_id: string; actor_org_id: string; before: unknown; after: unknown; actor_user_id: string }>(
    "select organization_id, actor_org_id, before, after, actor_user_id from audit_logs where candidate_id = $1 and action = 'candidate.share_disable' and created_at >= $2", [cid, startedAt]);
  expect(log.before).toEqual({ sharedWithTsk: true });
  expect(log.after).toEqual({ sharedWithTsk: false });
  expect(log.organization_id).toBe(log.actor_org_id);
});

test("mengaktifkan: checkbox konfirmasi wajib (browser dan server); cap waktu dan pelaku tercatat; kandidat muncul lagi", async ({ page, browser }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  const form = page.getByTestId("sharing-enable-form");
  await expect(form.getByTestId("sharing-confirm")).not.toBeChecked();
  await expect(form).toContainText("Siswa sudah setuju datanya dibagikan ke TSK mitra");

  // Tanpa mencentang: browser menolak mengirim
  await form.getByRole("button", { name: "Bagikan ke TSK mitra" }).click();
  expect(await form.getByTestId("sharing-confirm").evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await expect(page.getByTestId("sharing-state")).toHaveText("Belum dibagikan");

  // Validasi browser dilewati: server tetap menolak
  await form.getByTestId("sharing-confirm").evaluate((el) => (el as HTMLInputElement).removeAttribute("required"));
  await form.getByRole("button", { name: "Bagikan ke TSK mitra" }).click();
  await expect(form.locator("p[role=alert]")).toHaveText("Centang konfirmasi bahwa siswa sudah setuju.");
  const [still] = await ownerQuery<{ shared_with_tsk: boolean }>("select shared_with_tsk from candidates where id = $1", [cid]);
  expect(still.shared_with_tsk).toBe(false);

  // Dengan konfirmasi
  await form.getByTestId("sharing-confirm").check();
  await form.getByRole("button", { name: "Bagikan ke TSK mitra" }).click();
  await expect(page.getByTestId("sharing-state")).toHaveText("Dibagikan ke TSK mitra");

  const [row] = await ownerQuery<{ shared_with_tsk: boolean; at: Date | null; by: string | null; email: string | null }>(
    "select c.shared_with_tsk, c.shared_with_tsk_at as at, c.shared_with_tsk_by as by, u.email from candidates c left join users u on u.id = c.shared_with_tsk_by where c.id = $1", [cid]);
  expect(row.shared_with_tsk).toBe(true);
  expect(row.at).not.toBeNull();
  expect(row.email).toBe("lpk1.admin@hashi.test"); // pelaku diisi database dari user yang login
  const [log] = await ownerQuery<{ before: unknown; after: unknown }>(
    "select before, after from audit_logs where candidate_id = $1 and action = 'candidate.share_enable' and created_at >= $2", [cid, startedAt]);
  expect(log.before).toEqual({ sharedWithTsk: false });
  expect(log.after).toEqual({ sharedWithTsk: true });

  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  expect(await tskSees(tsk)).toBe(1);
});

test("sensei dan TSK tidak melihat pengaturan berbagi; tanggal formulir opsional dan berformat lokal", async ({ page, browser }) => {
  const sensei = await (await browser.newContext()).newPage();
  await login(sensei, "lpk1.sensei@hashi.test");
  await sensei.goto(url);
  await expect(sensei.locator("[data-testid=section-sharing]")).toHaveCount(0);
  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  await tsk.goto(url);
  await expect(tsk.locator("[data-testid=section-sharing]")).toHaveCount(0);
  await expect(tsk.locator("[data-testid=sharing-form]")).toHaveCount(0);

  await login(page, "lpk1.admin@hashi.test");
  await page.goto(url);
  await page.locator("#consent-date").fill("2026-03-05");
  await page.getByRole("button", { name: "Simpan tanggal" }).click();
  await expect(page.getByTestId("value-consent")).toHaveText("5 Maret 2026");
  await tsk.goto(url);
  await expect(tsk.getByTestId("value-consent")).toHaveText("2026年3月5日");

  // Tanggal formulir BUKAN gerbang: dikosongkan, kandidat tetap terlihat TSK
  await page.locator("#consent-date").fill("");
  await page.getByRole("button", { name: "Simpan tanggal" }).click();
  await expect(page.getByTestId("value-consent")).toHaveText("—");
  expect(await tskSees(tsk)).toBe(1);

  const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await page.locator("#consent-date").evaluate((el, v) => { el.removeAttribute("max"); (el as HTMLInputElement).value = v; }, future);
  await page.getByRole("button", { name: "Simpan tanggal" }).click();
  await expect(page.locator("[data-testid=consent-form] p[role=alert]")).toHaveText("Tanggal tidak boleh di masa depan.");
});
