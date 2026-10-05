import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { login, ownerQuery } from "./helpers";

const ROOT = path.resolve(process.env.E2E_STORAGE_DIR ?? `${process.cwd()}/.e2e-docs`); // e2e memakai penyimpanan sendiri; berkas lampiran seed ada di docs-data

// Catatan kegiatan (langkah 7A): khusus staf TSK. LPK, sensei, dan super admin tidak melihat apa pun (menu, rute, data, lampiran, ekspor).

const ROUTES = ["/records", "/records/meetings", "/records/cases", "/records/interviews", "/records/tasks", "/records/reports", "/records/new?kind=daily_work", "/records/cases/new"];
const sidebarLink = (page: Page, href: string) => page.locator(`[data-testid=sidebar] a[href="${href}"]`);

for (const email of ["lpk1.admin@hashi.test", "lpk1.sensei@hashi.test", "lpk2.admin@hashi.test", "admin@hashi.test"]) {
  test(`${email}: menu tidak ada di DOM; semua rute /records 404; ekspor dan lampiran tertutup`, async ({ page }) => {
    await login(page, email);
    await expect(sidebarLink(page, "/records")).toHaveCount(0);
    expect(await page.content()).not.toContain("/records");
    for (const r of ROUTES) expect((await page.goto(r))?.status(), `${email} ${r}`).toBe(404);
    const [rec] = await ownerQuery<{ id: string }>("select id::text from activity_records limit 1");
    const [att] = await ownerQuery<{ id: string }>("select id::text from activity_attachments limit 1");
    const [kase] = await ownerQuery<{ id: string }>("select id::text from activity_cases limit 1");
    for (const u of [`/records/${rec.id}`, `/records/${rec.id}/edit`, `/records/cases/${kase.id}`, `/records/cases/${kase.id}/export`]) expect((await page.goto(u))?.status(), u).toBe(404);
    for (const u of [`/records/export/record/${rec.id}`, `/records/export/daily?date=2026-10-05`, `/records/export/case/${kase.id}?mode=internal`, `/records/export/interview/${rec.id}`, `/records/attachments/${att.id}`]) {
      expect((await page.request.get(u)).status(), u).toBe(404);
    }
    // dashboard: tidak ada widget/KPI catatan kegiatan di DOM maupun HTML
    await page.goto("/");
    const html = await page.content();
    for (const id of ["kpi-records-unread", "kpi-interviews-pending", "kpi-followups-open", "w-my-followups", "w-open-cases"]) expect(html).not.toContain(id);
  });
}

test("TSK_ADMIN dan TSK_STAFF: menu Catatan kegiatan ada, 'Segera hadir' hanya Residence Card; semua rute 200", async ({ browser }) => {
  for (const email of ["tsk.admin@hashi.test", "tsk.staff@hashi.test"]) {
    const page = await (await browser.newContext()).newPage();
    await login(page, email);
    await expect(sidebarLink(page, "/records")).toHaveCount(1);
    await expect(page.getByTestId("nav-soon").locator("li")).toHaveCount(1); // Wawancara berkala tidak lagi "segera hadir"
    for (const r of ROUTES) expect((await page.goto(r))?.status(), `${email} ${r}`).toBe(200);
    await expect(page.getByTestId("topbar-title")).toBeVisible();
    await page.context().close();
  }
});

test("lampiran: staf TSK 200 + attachment + nosniff + tidak di-cache; id acak 404", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  const [att] = await ownerQuery<{ id: string; org: string }>("select id::text, organization_id::text as org from activity_attachments where removed_at is null limit 1");
  await mkdir(path.join(ROOT, "activity", att.org), { recursive: true });
  await writeFile(path.join(ROOT, "activity", att.org, `${att.id}.png`), await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c2410c" } }).png().toBuffer());
  const res = await page.request.get(`/records/attachments/${att.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["cache-control"]).toMatch(/no-store/);
  expect((await page.request.get("/records/attachments/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  expect((await page.request.get("/records/attachments/bukan-uuid")).status()).toBe(404);
});
