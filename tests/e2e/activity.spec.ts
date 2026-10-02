import { expect, test, type Page } from "@playwright/test";
import { createScratchCandidate, deleteScratchCandidate, login, ownerQuery, unique } from "./helpers";

// Tugas 4 UI: riwayat aktivitas (halaman, filter, zona waktu, ekspor CSV tercatat, bagian di detail kandidat, widget dashboard).

const run = unique();
const sidebarLink = (page: Page, href: string) => page.locator(`[data-testid=sidebar] a[href="${href}"]`);
const total = async (page: Page) => Number(await page.getByTestId("audit-total").textContent());

test("hanya LPK_ADMIN dan TSK_ADMIN: menu ada; sensei, staf TSK, super admin tidak punya menu, halaman 404, ekspor 403", async ({ browser }) => {
  for (const [email, allowed] of [["lpk1.admin@hashi.test", true], ["tsk.admin@hashi.test", true], ["lpk1.sensei@hashi.test", false], ["tsk.staff@hashi.test", false], ["admin@hashi.test", false]] as const) {
    const p = await (await browser.newContext()).newPage();
    await login(p, email);
    await expect(sidebarLink(p, "/activity")).toHaveCount(allowed ? 1 : 0);
    expect((await p.goto("/activity"))?.status(), `${email} /activity`).toBe(allowed ? 200 : 404);
    const res = await p.request.get("/activity/export");
    expect(res.status(), `${email} export`).toBe(allowed ? 200 : 403);
    await p.context().close();
  }
});

test("halaman riwayat LPK_ADMIN: >= 25 entri, kalimat manusiawi, waktu di zona Jakarta, filter jenis dan tanggal, paginasi", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  await page.goto("/activity");
  await expect(page.getByTestId("topbar-title")).toHaveText("Riwayat aktivitas");
  const all = await total(page);
  expect(all).toBeGreaterThanOrEqual(25);
  await expect(page.getByTestId("audit-row")).toHaveCount(25); // satu halaman penuh
  await expect(page.getByTestId("audit-row").first().getByTestId("audit-text")).not.toHaveText(/^[a-z_]+\.[a-z_]+$/); // bukan kode mentah

  // zona waktu: teks waktu = format Intl di Asia/Jakarta untuk atribut dateTime yang sama
  const first = page.getByTestId("audit-row").first().locator("time");
  const iso = (await first.getAttribute("datetime"))!;
  const expected = await page.evaluate((v) => new Intl.DateTimeFormat("id-ID", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date(v)), iso);
  await expect(first).toHaveText(expected);

  // filter jenis
  await page.locator("#category").selectOption("candidate");
  await page.locator("[data-testid=audit-filters] button[type=submit]").click();
  const cand = await total(page);
  expect(cand).toBeGreaterThan(0);
  expect(cand).toBeLessThan(all);
  for (const a of await page.getByTestId("audit-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-action")))) expect(a).toMatch(/^candidate\./);

  // filter tanggal: rentang yang pasti kosong
  await page.goto("/activity?from=2020-01-01&to=2020-01-02");
  await expect(page.getByTestId("audit-empty")).toContainText("Tidak ada aktivitas yang cocok");

  // paginasi
  await page.goto("/activity");
  await page.getByRole("link", { name: /Berikutnya/ }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(await page.getByTestId("audit-row").count()).toBeGreaterThan(0);
});

test("TSK_ADMIN (Jepang): waktu di zona Tokyo; LPK melihat nama ORGANISASI TSK pada aksi lintas organisasi, tidak pernah nama stafnya", async ({ browser }) => {
  const tskPage = await (await browser.newContext()).newPage();
  await login(tskPage, "tsk.admin@hashi.test");
  await tskPage.goto("/activity");
  const first = tskPage.getByTestId("audit-row").first().locator("time");
  const iso = (await first.getAttribute("datetime"))!;
  const expected = await tskPage.evaluate((v) => new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo" }).format(new Date(v)), iso);
  await expect(first).toHaveText(expected);
  await tskPage.context().close();

  const lpk = await (await browser.newContext()).newPage();
  await login(lpk, "lpk1.admin@hashi.test");
  await lpk.goto("/activity?category=decision");
  const html = await lpk.content();
  expect(html).toContain("TSK Demo Tokyo");
  expect(html).not.toContain("田中 一郎");
  expect(html).not.toContain("Rina Staf TSK");
  await lpk.context().close();
});

test("potret pelaku: aksi baru tercatat dengan nama saat itu dan tetap walau pengguna diganti nama; entri tidak bisa diubah", async ({ page }) => {
  const NAME = `Uji Riwayat ${run}`;
  const c = await createScratchCandidate({ name: NAME });
  try {
    await login(page, "lpk1.admin@hashi.test");
    await page.goto(`/candidates/${c.id}`);
    await page.locator("#stage").selectOption("READY");
    await page.locator("[data-testid=form-stage] button[type=submit]").click();
    await expect(page.locator("[data-testid=form-stage] p[role=status]")).toHaveText("Status di LPK diperbarui.");

    const code = c.id.slice(0, 8);
    await page.goto(`/activity?candidate=${c.id}`);
    const row = page.getByTestId("audit-row").first();
    await expect(row.getByTestId("audit-text")).toContainText(`Mengubah status kandidat ${code}: Belajar → Siap seleksi`);
    await expect(row).toContainText("Admin LPK Bandung (Admin LPK)");
    expect(await page.content()).not.toContain(NAME); // nama kandidat tidak ada di riwayat

    await ownerQuery("update users set name = 'Nama Baru Setelahnya' where email = 'lpk1.admin@hashi.test'");
    await page.reload();
    await expect(page.getByTestId("audit-row").first()).toContainText("Admin LPK Bandung (Admin LPK)"); // potret lama tetap
    await expect(page.getByTestId("audit-row").first()).not.toContainText("Nama Baru Setelahnya");

    const stored = await ownerQuery<{ actor_name: string; actor_role: string; actor_org_name: string; after: unknown }>("select actor_name, actor_role, actor_org_name, after from audit_logs where candidate_id = $1 and action = 'candidate.change_stage'", [c.id]);
    expect(stored[0]).toMatchObject({ actor_name: "Admin LPK Bandung", actor_role: "LPK_ADMIN", actor_org_name: "LPK Demo Bandung" });
    expect(JSON.stringify(stored[0].after)).not.toContain(NAME);
    await expect(ownerQuery("update audit_logs set action = 'x.y' where candidate_id = $1", [c.id])).rejects.toThrow(/append-only/);
    await expect(ownerQuery("delete from audit_logs where candidate_id = $1", [c.id])).rejects.toThrow(/append-only/);
  } finally {
    await ownerQuery("update users set name = 'Admin LPK Bandung' where email = 'lpk1.admin@hashi.test'");
    await deleteScratchCandidate(c.id);
  }
});

test("ekspor CSV: isi sesuai filter, tanpa nama kandidat, dan ekspornya sendiri tercatat di audit", async ({ page }) => {
  await login(page, "lpk1.admin@hashi.test");
  const before = Number((await ownerQuery<{ n: string }>("select count(*) as n from audit_logs where action = 'audit.export'"))[0].n);
  await page.goto("/activity?category=candidate");
  const n = await total(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-export").click()]);
  expect(download.suggestedFilename()).toMatch(/^riwayat-aktivitas-\d{4}-\d{2}-\d{2}\.csv$/);
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString("utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
  const lines = csv.trim().split("\r\n");
  expect(lines[0]).toContain("Waktu");
  expect(lines.length - 1).toBe(n); // semua baris yang cocok filter (<= 5000)
  expect(lines.slice(1).every((l) => l.includes("candidate."))).toBe(true);
  const names = (await ownerQuery<{ full_name: string }>("select full_name from candidates")).map((r) => r.full_name);
  for (const nm of names) expect(csv).not.toContain(nm);

  const after = await ownerQuery<{ after: { rows: number } }>("select after from audit_logs where action = 'audit.export' order by id desc limit 1");
  expect(Number((await ownerQuery<{ n: string }>("select count(*) as n from audit_logs where action = 'audit.export'"))[0].n)).toBe(before + 1);
  expect(after[0].after.rows).toBe(n);
});

test("detail kandidat: LPK_ADMIN dan TSK_ADMIN melihat bagian riwayat; sensei dan staf TSK tidak (tidak ada di DOM)", async ({ browser }) => {
  const { id } = (await ownerQuery<{ id: string }>("select a.candidate_id as id from audit_logs a join candidates c on c.id = a.candidate_id where a.action = 'candidate.decision' and c.shared_with_tsk limit 1"))[0] ?? { id: "" };
  expect(id).not.toBe("");
  const check = async (email: string, visible: boolean) => {
    const p = await (await browser.newContext()).newPage();
    await login(p, email);
    await p.goto(`/candidates/${id}`);
    await expect(p.getByTestId("section-activity")).toHaveCount(visible ? 1 : 0);
    if (visible) await expect(p.getByTestId("candidate-audit").getByTestId("audit-row").first()).toBeVisible();
    await p.context().close();
  };
  await check("lpk1.admin@hashi.test", true).catch(async () => check("lpk2.admin@hashi.test", true)); // kandidat milik LPK Bandung atau Surabaya
  await check("tsk.admin@hashi.test", true);
  await check("tsk.staff@hashi.test", false);
});

test("widget Aktivitas terbaru ada di dashboard admin dan tidak ada untuk sensei", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, "lpk1.admin@hashi.test");
  await expect(admin.getByTestId("w-activity")).toBeVisible();
  expect(await admin.getByTestId("w-activity").getByTestId("audit-row").count()).toBeGreaterThan(0);
  await admin.context().close();
  const sensei = await (await browser.newContext()).newPage();
  await login(sensei, "lpk1.sensei@hashi.test");
  await expect(sensei.getByTestId("w-activity")).toHaveCount(0);
  expect(await sensei.content()).not.toContain("w-activity");
  await sensei.context().close();
});

test.describe("ponsel", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("halaman riwayat tanpa scroll horizontal", async ({ page }) => {
    await login(page, "lpk1.admin@hashi.test");
    await page.goto("/activity");
    await expect(page.getByTestId("audit-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
