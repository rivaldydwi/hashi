import { expect, test, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createScratchCandidate, deleteScratchCandidate, login, ownerQuery, unique } from "./helpers";

// Catatan kegiatan (langkah 7A): wawancara berkala (grid, sel, riwayat, KPI), konsistensi KPI-daftar, PDF (teks Jepang, versi klien), dashboard,
// bagian di detail pekerja, hapus kandidat yang punya catatan, dan tampilan ponsel.

const run = unique();
const norm = (s: string) => s.replace(/\s+/g, "");
const curMonth = () => `${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7)}-01`;

async function pdfText(buf: Buffer | Uint8Array): Promise<{ text: string; pages: number }> {
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return { text: out.join("\n"), pages: doc.numPages };
}
const num = async (page: Page, id: string) => Number(await page.getByTestId(id).textContent());

test.describe("wawancara berkala", () => {
  test.describe.configure({ mode: "serial" });
  let cid = "";
  let month = "";

  test("grid: legenda, status per KUARTAL (selesai/belum) dan penanda bulan (selesai/tidak berlaku) dengan teks, kolom identitas, catatan kuartal, filter bulan/status, aturan kuartal tampil", async ({ page }) => {
    await login(page, "tsk.staff@hashi.test");
    await page.goto("/records/interviews");
    await expect(page.getByTestId("interview-legend")).toContainText("Selesai");
    await expect(page.getByTestId("interview-legend")).toContainText("Belum");
    await expect(page.getByTestId("interview-legend")).toContainText("Tidak berlaku");
    await expect(page.getByTestId("interview-rule")).toContainText("minimal sekali per kuartal");
    for (const state of ["done", "open", "missed"]) {
      const q = page.locator(`[data-testid=quarter-state][data-state=${state}]`).first();
      await expect(q).toBeVisible();
      await expect(q).toContainText({ done: "Selesai", open: "Belum, tenggat", missed: "Terlewat" }[state]!); // setiap keadaan punya teks, bukan hanya ikon/warna
    }
    // kuartal berjalan (open) BUKAN merah; hanya yang sudah lewat (missed) merah
    await expect(page.locator("[data-testid=quarter-state][data-state=open]").first()).not.toHaveClass(/text-rose/);
    await expect(page.locator("[data-testid=quarter-state][data-state=missed]").first()).toHaveClass(/text-rose/);
    for (const state of ["done", "na"]) {
      const cell = page.locator(`[data-testid=interview-cell][data-state=${state}]`).first();
      await expect(cell).toBeVisible();
      await expect(cell).toContainText({ done: "Selesai", na: "Tidak berlaku" }[state]!);
    }
    // bulan tanpa wawancara BUKAN tanda merah: tidak ada teks "Belum" di sel bulan (hanya di status kuartal)
    await expect(page.locator("[data-testid=interview-cell][data-state=none]").first()).not.toContainText(/^.*Belum$/);
    expect(await page.locator("[data-testid=interview-cell][data-state=pending]").count()).toBe(0);
    await expect(page.getByTestId("interview-grid").locator("thead")).toContainText("Bidang SSW");
    await expect(page.getByTestId("interview-grid").locator("thead")).toContainText("Catatan Q1");
    await expect(page.getByTestId("quarter-cell").first()).toBeVisible();
    // filter: hanya status tertentu
    await page.goto("/records/interviews?status=open");
    const cells = page.locator("[data-testid=interview-row]");
    expect(await cells.count()).toBeGreaterThan(0);
    await expect(page.getByTestId("filter-chips")).toBeVisible();
    // filter status memakai status KUARTAL: setiap baris yang tampil punya >= 1 kuartal berjalan belum diisi (open)
    for (const r of await cells.all()) expect(await r.locator("[data-testid=quarter-state][data-state=open]").count()).toBeGreaterThan(0);
  });

  test("KPI 'Wawancara berkala kuartal ini belum dilakukan' = jumlah kuartal BERJALAN (open) di grid tersaring; klik KPI membuka grid itu", async ({ page }) => {
    await login(page, "tsk.admin@hashi.test");
    await page.goto("/");
    const kpi = await num(page, "kpi-interviews-pending-value");
    expect(kpi).toBeGreaterThan(0);
    await page.getByTestId("kpi-interviews-pending").click();
    await expect(page).toHaveURL(/\/records\/interviews\?view=pending/);
    await expect(page.getByTestId("pending-cells-count")).toContainText(String(kpi));
    expect(await page.locator("[data-testid=quarter-state][data-state=open]").count()).toBe(kpi); // KPI = kuartal berjalan; kuartal terlewat tidak ikut
  });

  test("isi wawancara di kuartal berjalan (open): status + alasan, kuartal menjadi Selesai, KPI turun 1; edit -> riwayat; 問題あり menawarkan kasus dan tugas", async ({ page }) => {
    await login(page, "tsk.staff@hashi.test");
    await page.goto("/");
    const before = await num(page, "kpi-interviews-pending-value");
    await page.goto("/records/interviews?view=pending");
    const q = page.locator("[data-testid=quarter-state][data-state=open]").first();
    await expect(q).toBeVisible();
    const row = q.locator("xpath=ancestor::tr");
    cid = (await row.getAttribute("data-worker"))!;
    const qn = Number(await q.locator("xpath=ancestor::td").getAttribute("data-quarter"));
    const inQuarter = ({ 1: [4, 5, 6], 2: [7, 8, 9], 3: [10, 11, 12], 4: [1, 2, 3] } as Record<number, number[]>)[qn];
    // bulan pertama di kuartal itu yang bisa diisi (bukan di luar masa kerja)
    month = (await row.locator("[data-testid=interview-cell]:not([data-state=notDue])").evaluateAll((els) => els.map((e) => e.getAttribute("data-month")!)))
      .find((m) => inQuarter.includes(Number(m.slice(5, 7))))!;
    expect(month, "ada bulan yang bisa diisi di kuartal Belum").toBeTruthy();
    await row.locator(`[data-testid=interview-cell][data-month="${month}"]`).getByTestId("interview-cell-link").click();
    await page.waitForURL(/\/records\/interviews\/[0-9a-f-]{36}\/\d{4}-\d{2}-01$/);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    await page.locator("#interviewDate").fill(month === curMonth() ? today : `${month.slice(0, 7)}-15`);
    await page.locator("#resultStatus").selectOption("issue");
    await page.locator("#reason").selectOption("worker");
    await page.locator("#content").fill(`面談内容${run}`);
    await page.getByTestId("interview-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("interview-state")).toContainText("Ada masalah");
    await expect(page.getByTestId("case-from-interview-form")).toBeVisible(); // 問題あり: tawarkan kasus
    await expect(page.getByTestId("add-followup-toggle")).toBeVisible(); // dan tugas
    await page.goto("/");
    expect(await num(page, "kpi-interviews-pending-value")).toBe(before - 1);
    // edit -> versi 2 + riwayat
    await page.goBack();
    await page.goto(`/records/interviews/${cid}/${month}`);
    await page.locator("#resultStatus").selectOption("follow_up");
    await page.locator("#content").fill(`面談内容変更${run}`);
    await page.getByTestId("interview-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("revision-item")).toHaveCount(1);
    await expect(page.getByTestId("revision-item").first().getByTestId("rev-before").first()).toBeVisible();
    // tugas dari wawancara
    await page.getByTestId("add-followup-toggle").click();
    await page.locator("#fu-desc").fill(`フォロー${run}`);
    await page.getByTestId("add-followup-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("followup-item").filter({ hasText: `フォロー${run}` })).toBeVisible();
    // kasus dari wawancara -> halaman kasus (judul Jepang, pekerja tertaut)
    await page.getByTestId("case-from-interview-form").locator("button[type=submit]").click();
    await page.waitForURL(/\/records\/cases\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("case-title")).toContainText("定期面談");
    await expect(page.getByTestId("case-workers").locator("a")).toHaveCount(1);
  });

  test("PDF 定期面談 satu pekerja: judul tahun fiskal, label baku, isi Jepang, kuartal; ekspor tercatat di audit", async ({ page }) => {
    await login(page, "tsk.staff@hashi.test");
    const fy = new Date().getUTCMonth() >= 3 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
    const res = await page.request.get(`/records/export/interview/${cid}?fy=${fy}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    const { text } = await pdfText(await res.body());
    const t = norm(text);
    expect(t).toContain(`定期面談${fy}/4-${fy + 1}/3`);
    for (const l of ["氏名", "特定技能分野", "就労開始日", "配属先企業名", "面談日", "ステータス", "面談内容", "実施理由", "担当者", "Q1備考"]) expect(t, l).toContain(l);
    expect(t).toContain(`面談内容変更${run}`);
    expect(t).toContain("要フォロー");
    const [a] = await ownerQuery<{ n: string }>("select count(*) as n from audit_logs where action = 'activity_export' and after->>'exportKind' = 'periodic_interview' and created_at > now() - interval '5 minutes'");
    expect(Number(a.n)).toBeGreaterThan(0);
  });
});

test("KPI dashboard = daftar yang dituju: belum dibaca (catatan + laporan), tindak lanjut terbuka; lencana sidebar = KPI belum dibaca", async ({ browser }) => {
  for (const [email, scope] of [["tsk.admin@hashi.test", "all"], ["tsk.staff@hashi.test", "mine"]] as const) {
    const page = await (await browser.newContext()).newPage();
    await login(page, email);
    await page.goto("/");
    const unread = await num(page, "kpi-records-unread-value");
    const fu = await num(page, "kpi-followups-open-value");
    await expect(page.locator('[data-testid=sidebar] a[href="/records"] [data-testid=nav-badge]')).toHaveText(String(unread));
    await page.getByTestId("kpi-records-unread").click();
    await expect(page).toHaveURL(/\/records\?view=unread/);
    const summary = (await page.getByTestId("unread-summary").textContent())!;
    const [records, reports] = (summary.match(/\d+/g) ?? []).map(Number);
    expect(records + reports, `${email}: ${summary}`).toBe(unread);
    expect(Number(await page.getByTestId("records-total").textContent())).toBe(records);
    await page.goto("/");
    await page.getByTestId("kpi-followups-open").click();
    await expect(page).toHaveURL(new RegExp(`/records/tasks\\?scope=${scope}&status=open`));
    expect(Number(await page.getByTestId("tasks-total").textContent())).toBe(fu);
    await page.context().close();
  }
});

test("tugas lewat tenggat dari seed tampil dengan teks 'Lewat tenggat' di tab Tindak lanjut (semua)", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  await page.goto("/records/tasks?scope=all&status=overdue");
  expect(await page.getByTestId("followup-item").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("badge-overdue").first()).toContainText(/期限超過|Lewat tenggat/);
});

test("PDF catatan ①, ②, laporan harian, 時系列 internal; versi klien butuh konfirmasi; teks Jepang di PDF", async ({ page }) => {
  await login(page, "tsk.staff@hashi.test");
  const [daily] = await ownerQuery<{ id: string; d: string; a: string }>("select id::text, record_date::text as d, action_taken as a from activity_records where kind = 'daily_work' and status = 'active' and action_taken ~ '[一-龠]' order by created_at limit 1");
  const [meet] = await ownerQuery<{ id: string; s: string }>("select id::text, subject as s from activity_records where kind = 'meeting' and status = 'active' order by created_at limit 1");
  const r1 = await page.request.get(`/records/export/record/${daily.id}`);
  expect(r1.status()).toBe(200);
  const t1 = norm((await pdfText(await r1.body())).text);
  for (const l of ["日付", "担当者", "対象者", "所属先", "業務内容", "対応内容", "結果・状況", "未対応・継続事項", "今後の対応", "共有・報告先", "備考"]) expect(t1, l).toContain(l);
  expect(t1).toContain(norm(daily.a.split("\n")[0]).slice(0, 12));
  const r2 = await page.request.get(`/records/export/record/${meet.id}`);
  const t2 = norm((await pdfText(await r2.body())).text);
  expect(t2).toContain(`件名:${norm(meet.s)}`);
  for (const l of ["日時", "対象者", "対応者", "場所・方法"]) expect(t2, l).toContain(l);
  expect(/\d\.(相談・面談内容|本人の話・意向|現在の状況|対応内容|今後の対応|共有事項|未対応事項)/.test(t2)).toBe(true);
  const r3 = await page.request.get(`/records/export/daily?date=${daily.d}`);
  expect(r3.status()).toBe(200);
  const t3 = norm((await pdfText(await r3.body())).text);
  expect(t3).toContain("業務記録");
  expect((await page.request.get("/records/export/daily?date=bukan-tanggal")).status()).toBe(400);
  expect((await page.request.get("/records/export/daily?date=1999-01-01")).status()).toBe(404);

  const [kase] = await ownerQuery<{ id: string; code: string }>("select c.id::text, c.code from activity_cases c where (select count(*) from case_timeline_events e where e.case_id = c.id) >= 6 order by c.code limit 1");
  const internal = await page.request.get(`/records/export/case/${kase.id}?mode=internal`);
  const ti = norm((await pdfText(await internal.body())).text);
  expect(ti).toContain(kase.code);
  for (const l of ["日時", "出来事・状況", "本人の発言・対応", "当社の対応", "備考"]) expect(ti, l).toContain(l);
  expect(ti).toContain("取消済み"); // baris yang dibatalkan ikut di versi internal
  expect(ti).toContain("作成:");
  expect((await page.request.get(`/records/export/case/${kase.id}?mode=client`)).status()).toBe(400); // tanpa konfirmasi

  // pratinjau + konfirmasi wajib + kolom 備考 opsional (lewat UI)
  await page.goto(`/records/cases/${kase.id}`);
  await page.getByTestId("export-case-client").click();
  await expect(page.getByTestId("client-preview")).toBeVisible();
  await expect(page.getByTestId("download-client-disabled")).toBeDisabled();
  await expect(page.getByTestId("download-client")).toHaveCount(0);
  const previewHtml = await page.getByTestId("client-preview").innerHTML();
  expect(previewHtml).not.toContain(kase.code);
  expect(await page.getByTestId("preview-row").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("excluded-note")).toBeVisible(); // baris internal/batal tidak ikut
  await page.getByTestId("include-notes").uncheck();
  await expect(page.getByTestId("preview-note-col")).toHaveCount(0);
  await page.getByTestId("confirm-check").check();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-client").click()]);
  expect(dl.suggestedFilename()).not.toContain(kase.code);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const tc = norm((await pdfText(Buffer.concat(chunks))).text);
  expect(tc).toContain("出来事・状況");
  expect(tc).not.toContain("備考"); // dimatikan sebelum unduh
  for (const hidden of ["RinaStafTSK", "田中一郎", kase.code, "作成:", "取消済み", "社内メモ"]) expect(tc, hidden).not.toContain(hidden);
  // versi klien dengan 備考 (bawaan): kolom tetap tampil
  const withNotes = norm((await pdfText(await (await page.request.get(`/records/export/case/${kase.id}?mode=client&confirm=1&notes=1`)).body())).text);
  expect(withNotes).toContain("備考");
  expect(withNotes).not.toContain("RinaStafTSK");
  // audit: ekspor tercatat dengan jenis, jumlah baris, dan penanda versi klien (tanpa isi)
  const exp = await ownerQuery<{ after: { exportKind: string; rows: number; clientVersion: boolean } }>("select after from audit_logs where action = 'activity_export' and created_at > now() - interval '10 minutes' order by id");
  expect(exp.some((e) => e.after.exportKind === "case_timeline" && e.after.clientVersion === true && e.after.rows >= 1)).toBe(true);
  expect(exp.some((e) => e.after.exportKind === "case_timeline" && e.after.clientVersion === false)).toBe(true);
  expect(exp.some((e) => e.after.exportKind === "daily_report")).toBe(true);
  expect(JSON.stringify(exp)).not.toMatch(/[぀-ヿ一-鿿]/);
});

test("dashboard: widget baru muncul bagi TSK (admin dan staf); layout tersimpan lama tetap berfungsi dan widget baru ditambahkan di bawah dalam keadaan tampil", async ({ browser }) => {
  const [u] = await ownerQuery<{ id: string; org: string }>("select id::text, organization_id::text as org from users where email = 'tsk.staff@hashi.test'");
  await ownerQuery("delete from user_dashboard_layouts where user_id = $1", [u.id]);
  try {
    await ownerQuery("insert into user_dashboard_layouts (user_id, org_id, layout) values ($1, $2, $3::jsonb)", [u.id, u.org, JSON.stringify({ v: 1, items: [{ id: "kpi-new-shared" }, { id: "kpi-awaiting", hidden: true }, { id: "pipeline", size: "full" }, { id: "open-jobs" }] })]);
    const page = await (await browser.newContext()).newPage();
    await login(page, "tsk.staff@hashi.test");
    await expect(page.getByTestId("kpi-new-shared")).toBeVisible();
    await expect(page.getByTestId("kpi-awaiting")).toHaveCount(0); // yang disembunyikan tetap tersembunyi
    for (const id of ["kpi-records-unread", "kpi-interviews-pending", "kpi-followups-open", "w-my-followups", "w-open-cases"]) await expect(page.getByTestId(id), id).toBeVisible();
    // urutan: widget lama lebih dulu, widget baru sesudahnya
    const ids = await page.locator("[data-testid^=w-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(ids.indexOf("w-pipeline")).toBeLessThan(ids.indexOf("w-my-followups"));
    expect(ids.indexOf("w-open-jobs")).toBeLessThan(ids.indexOf("w-open-cases"));
    // mode atur menampilkan widget baru
    await page.goto("/?atur=1");
    await expect(page.getByTestId("edit-bar-kpi-records-unread")).toBeVisible();
    await expect(page.getByTestId("edit-bar-my-followups")).toBeVisible();
    await page.context().close();
  } finally {
    await ownerQuery("delete from user_dashboard_layouts where user_id = $1", [u.id]);
  }
});

test("detail pekerja aktif (sisi TSK): bagian Catatan kegiatan + tambah catatan terisi pekerja; LPK pemilik tidak melihat apa pun", async ({ browser }) => {
  const [w] = await ownerQuery<{ id: string; org: string; lpk_admin: string }>("select c.id::text as id, c.organization_id::text as org, (select email from users u where u.organization_id = c.organization_id and u.role = 'LPK_ADMIN' limit 1) as lpk_admin from placements p join candidates c on c.id = p.candidate_id where p.status = 'ACTIVE' order by c.full_name limit 1");
  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  await tsk.goto(`/candidates/${w.id}`);
  await expect(tsk.getByTestId("section-worker-records")).toBeVisible();
  expect(await tsk.getByTestId("worker-records").locator("li").count()).toBeGreaterThan(0);
  await tsk.getByTestId("worker-add-record").click();
  await expect(tsk).toHaveURL(new RegExp(`worker=${w.id}`));
  await expect(tsk.getByTestId(`worker-${w.id}`)).toBeChecked();
  await tsk.context().close();
  // kandidat yang bukan pekerja aktif: tidak ada bagian itu
  const [other] = await ownerQuery<{ id: string }>("select c.id::text as id from candidates c join organizations o on o.id = c.organization_id where o.name = 'LPK Demo Bandung' and c.shared_with_tsk and not exists (select 1 from placements p where p.candidate_id = c.id) limit 1");
  const tsk2 = await (await browser.newContext()).newPage();
  await login(tsk2, "tsk.admin@hashi.test");
  await tsk2.goto(`/candidates/${other.id}`);
  await expect(tsk2.getByTestId("section-worker-records")).toHaveCount(0);
  await tsk2.context().close();
  // LPK pemilik: tidak ada di DOM maupun HTML
  const lpk = await (await browser.newContext()).newPage();
  await login(lpk, w.lpk_admin);
  await lpk.goto(`/candidates/${w.id}`);
  const html = await lpk.content();
  expect(html).not.toContain("section-worker-records");
  expect(html).not.toContain("catatan-kegiatan");
  expect(html).not.toContain("/records/");
  await lpk.context().close();
});

test("hapus kandidat: yang punya catatan kegiatan ditolak (dialog menyatakan diblokir, tombol hapus nonaktif); database juga menolak", async ({ browser }) => {
  const c = await createScratchCandidate({ name: `Uji Catatan Hapus ${run}`, stage: "READY", shared: true });
  try {
    await ownerQuery("insert into periodic_interview_quarter_notes (organization_id, created_by, candidate_id, fiscal_year, quarter, note) select u.organization_id, u.id, $1, 2026, 1, 'catatan' from users u where u.email = 'tsk.admin@hashi.test'", [c.id]);
    const page = await (await browser.newContext()).newPage();
    await login(page, "lpk1.admin@hashi.test");
    await page.goto(`/candidates/${c.id}`);
    await page.getByTestId("delete-open").click();
    const dialog = page.getByTestId("delete-dialog");
    await expect(dialog.getByTestId("delete-blocked")).toBeVisible();
    await expect(dialog.getByTestId("delete-submit")).toBeDisabled();
    await page.context().close();
    await expect(ownerQuery("delete from candidates where id = $1", [c.id])).rejects.toThrow(/catatan di sisi TSK|tidak bisa dihapus|foreign key/);
    expect((await ownerQuery("select 1 from candidates where id = $1", [c.id])).length).toBe(1);
  } finally {
    // catatan kuartal tidak bisa dihapus lewat aplikasi; bersihkan lewat OWNER dengan menonaktifkan penjaga hanya untuk baris uji ini
    await ownerQuery("delete from periodic_interview_quarter_notes where candidate_id = $1", [c.id]);
    await deleteScratchCandidate(c.id);
  }
});

test.describe("ponsel 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("form ①, daftar, grid wawancara, dan halaman kasus: tanpa scroll horizontal di halaman, kontrol >= 44px", async ({ page }) => {
    await login(page, "tsk.staff@hashi.test");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const path of ["/records", "/records/new?kind=daily_work", "/records/new?kind=meeting", "/records/meetings", "/records/cases", "/records/interviews", "/records/tasks", "/records/reports"]) {
      await page.goto(path);
      await expect(page.getByTestId("records-tabs")).toBeVisible();
      expect(await overflow(), path).toBeLessThanOrEqual(0);
    }
    await page.goto("/records/new?kind=daily_work");
    for (const sel of ["#recordDate", "#workType", "#actionTaken", "[data-testid=save-record]", "[data-testid=photo-input] >> xpath=.."]) expect((await page.locator(sel).first().boundingBox())!.height, sel).toBeGreaterThanOrEqual(44);
    const [kase] = await ownerQuery<{ id: string }>("select id::text from activity_cases order by code limit 1");
    await page.goto(`/records/cases/${kase.id}`);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const [rec] = await ownerQuery<{ id: string }>("select id::text from activity_records order by created_at limit 1");
    await page.goto(`/records/${rec.id}`);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
