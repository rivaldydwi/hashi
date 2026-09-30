import { expect, test, type Page } from "@playwright/test";
import { createIsolatedLpk, login, ownerQuery, unique } from "./helpers";

// Daftar & tambah kandidat (langkah 3, bagian 1).
// Penambahan data memakai LPK baru per run (createIsolatedLpk) supaya angka data demo tidak bergeser.
// Angka data demo (dari scripts/seed.ts) untuk TSK Demo Tokyo: 23 kandidat terlihat =
//   8 Belajar + 13 Siap seleksi + 2 Mundur;  keputusan: 4 shortlist, 2 lulus wawancara TSK,
//   2 diajukan ke client, 2 lulus interview client, 13 belum diputuskan.

test.describe.configure({ mode: "serial" });

let lpk: { orgName: string; adminEmail: string; adminPassword: string };
const run = unique();
const nameA = `Kandidat Uji A${run}`;
const nameB = `Kandidat Uji B${run}`;

test.beforeAll(async ({ browser }) => {
  lpk = await createIsolatedLpk(browser);
});

async function fillCandidate(page: Page, v: { name: string; gender: "MALE" | "FEMALE"; birth: string; field: string; consent: string }) {
  await page.locator("#fullName").fill(v.name);
  await page.locator("#gender").selectOption(v.gender);
  await page.locator("#birthDate").fill(v.birth);
  await page.locator("#field").fill(v.field);
  await page.locator("#dataConsentDate").fill(v.consent);
}

/** Menunggu (dengan retry) sampai jumlah kandidat di halaman = n. Aman terhadap navigasi sisi klien. */
async function expectTotal(page: Page, n: number) {
  await expect(page.getByTestId("candidate-total")).toHaveText(String(n));
}

test("admin LPK menambah kandidat: muncul di daftar dan tercatat di audit log", async ({ page }) => {
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.getByRole("link", { name: "Kandidat", exact: true }).click();
  await expect(page.getByTestId("candidate-empty")).toBeVisible(); // LPK baru, belum ada kandidat
  await expectTotal(page, 0);

  await page.getByRole("link", { name: "+ Tambah kandidat" }).first().click();
  await fillCandidate(page, { name: nameA, gender: "FEMALE", birth: "2001-04-12", field: "Perawatan lansia (kaigo)", consent: "2026-08-01" });
  await page.locator("main form button[type=submit]").click();

  await expect(page).toHaveURL(/\/candidates\?added=1/);
  await expect(page.getByTestId("candidate-added")).toBeVisible();
  await expect(page.getByTestId("candidate-row")).toHaveCount(1);
  await expect(page.getByTestId("candidate-table")).toContainText(nameA);
  await expect(page.getByTestId("candidate-table")).toContainText("Belajar"); // status awal selalu STUDYING

  // Audit: pelaku, organisasi, dan kandidat tercatat; organisasi kandidat = organisasi user (bukan dari form)
  const [cand] = await ownerQuery<{ id: string; organization_id: string; stage: string; data_consent_date: string }>(
    "select id, organization_id, stage, to_char(data_consent_date, 'YYYY-MM-DD') as data_consent_date from candidates where full_name = $1",
    [nameA],
  );
  expect(cand.stage).toBe("STUDYING");
  expect(cand.data_consent_date).toBe("2026-08-01");
  const logs = await ownerQuery<{ action: string; organization_id: string; actor_org_id: string; candidate_id: string; after: { fullName: string; dataConsentDate: string } }>(
    "select action, organization_id, actor_org_id, candidate_id, after from audit_logs where entity_id = $1",
    [cand.id],
  );
  expect(logs).toHaveLength(1);
  expect(logs[0].action).toBe("candidate.create");
  expect(logs[0].organization_id).toBe(cand.organization_id);
  expect(logs[0].actor_org_id).toBe(cand.organization_id);
  expect(logs[0].candidate_id).toBe(cand.id);
  expect(logs[0].after.fullName).toBe(nameA);
  expect(logs[0].after.dataConsentDate).toBe("2026-08-01");
});

test("tanggal persetujuan di masa depan ditolak server, dan tidak ada kandidat yang tersimpan", async ({ page }) => {
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.goto("/candidates/new");
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await fillCandidate(page, { name: `Ditolak ${run}`, gender: "MALE", birth: "2000-01-01", field: "Konstruksi", consent: "2026-08-01" });
  // Lewati validasi browser (atribut max) supaya yang diuji benar-benar validasi server
  await page.locator("#dataConsentDate").evaluate((el, v) => {
    el.removeAttribute("max");
    (el as HTMLInputElement).value = v;
  }, future);
  await page.locator("main form button[type=submit]").click();
  await expect(page.locator("p[role=alert]")).toHaveText("Tanggal persetujuan tidak boleh di masa depan.");
  const rows = await ownerQuery("select 1 from candidates where full_name = $1", [`Ditolak ${run}`]);
  expect(rows).toHaveLength(0);
});

test("filter bidang, status, dan pencarian nama bekerja (termasuk karakter khusus)", async ({ page }) => {
  await login(page, lpk.adminEmail, lpk.adminPassword);
  await page.goto("/candidates/new");
  await fillCandidate(page, { name: nameB, gender: "MALE", birth: "1999-11-30", field: "Konstruksi", consent: "2026-08-02" });
  await page.locator("main form button[type=submit]").click();
  await expect(page).toHaveURL(/added=1/);
  await expectTotal(page, 2);

  await page.locator("#field").selectOption("Konstruksi");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expectTotal(page, 1);
  await expect(page.getByTestId("candidate-table")).toContainText(nameB);

  await page.getByRole("link", { name: "Reset" }).click();
  await expectTotal(page, 2);
  await expect(page.locator("#field")).toHaveValue(""); // kolom filter ikut kosong (bukan hanya URL-nya)
  await page.locator("#q").fill(nameA.toLowerCase()); // tidak peka huruf besar/kecil
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expectTotal(page, 1);
  await expect(page.getByTestId("candidate-table")).toContainText(nameA);

  await page.getByRole("link", { name: "Reset" }).click();
  await expectTotal(page, 2);
  await page.locator("#stage").selectOption("WITHDRAWN");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page.getByTestId("candidate-empty")).toContainText("Tidak ada kandidat yang cocok");

  await page.getByRole("link", { name: "Reset" }).click();
  await expect(page.locator("#stage")).toHaveValue("");
  await page.locator("#q").fill("%");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expectTotal(page, 0); // "%" dicari apa adanya, bukan wildcard
  await expect(page.locator("#decision")).toHaveCount(0); // filter keputusan hanya untuk TSK
});

test("sensei melihat daftar kandidat tetapi tidak bisa menambah", async ({ page }) => {
  await login(page, "lpk1.sensei@hashi.test");
  await page.goto("/candidates");
  await expectTotal(page, 12);
  await expect(page.getByRole("link", { name: "+ Tambah kandidat" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "LPK", exact: true })).toHaveCount(0);
  await page.goto("/candidates/new");
  await expect(page).toHaveURL(/\/$/); // diarahkan ke beranda
});

test("TSK melihat 23 kandidat di semua status; filter status & keputusan; tidak bisa menambah", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  await page.getByRole("link", { name: "候補者", exact: true }).click(); // TSK demo berbahasa Jepang
  await expect(page).toHaveURL(/\/candidates$/);
  await expectTotal(page, 23); // kandidat LPK baru (tanpa kemitraan) tidak ikut terlihat
  await expect(page.getByRole("link", { name: "+ 候補者を追加" })).toHaveCount(0);

  const filter = async (params: string, n: number) => {
    await page.goto(`/candidates?${params}`);
    await expectTotal(page, n);
  };
  await filter("stage=STUDYING", 8); // TSK melihat kandidat yang masih belajar
  await filter("stage=READY", 13);
  await filter("stage=WITHDRAWN", 2);
  await filter("decision=SHORTLISTED", 4);
  await filter("decision=PASSED_TSK_INTERVIEW", 2);
  await filter("decision=SUBMITTED_TO_CLIENT", 2);
  await filter("decision=PASSED_CLIENT_INTERVIEW", 2);
  await filter("decision=NONE", 13); // belum ada baris keputusan
  await filter("stage=STUDYING&decision=SHORTLISTED", 2); // shortlist walau LPK-nya masih Belajar
  await filter("decision=BUKAN_NILAI_VALID&stage=NGAWUR", 23); // nilai tak dikenal diabaikan

  await page.goto("/candidates/new");
  await expect(page).toHaveURL(/\/$/);
});

test("super admin tidak punya menu maupun akses ke daftar kandidat", async ({ page }) => {
  await login(page, "admin@hashi.test");
  await expect(page.getByRole("link", { name: "Kandidat", exact: true })).toHaveCount(0);
  await page.goto("/candidates");
  await expect(page).toHaveURL(/\/$/);
});
