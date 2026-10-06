import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  COMPLETENESS, LABELS, OPENING_COLUMNS, SECTIONS, SHARE_EXCLUDES, formatEmployees, formatGender, formatHousing, formatJpRequirement, formatSalaryYen, formatYmd, label,
} from "../../src/lib/pdf/client-sheet.config";
import { buildCompanySheet, buildJobOrderSheet, type CompanySheetData, type JobOrderSheetData } from "../../src/lib/pdf/client-sheet-model";
import { renderSheetPdf } from "../../src/lib/pdf/client-sheet";

const ctx = { orgName: "TSK Demo Tokyo", tz: "Asia/Tokyo", now: new Date("2026-10-05T05:20:00Z") };
const norm = (s: string) => s.replace(/\s+/g, "");
async function read(buf: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return { n: doc.numPages, text: pages.join("\n"), last: pages[pages.length - 1] };
}

const company = (over: Partial<CompanySheetData["company"]> = {}): CompanySheetData => ({
  company: { name: "さくらフーズ株式会社", hqAddress: "静岡県ダミー市ダミー町4-4-4", industry: "食品製造・外食", employeeCount: 320, foreignWorkerExperience: "2020年から特定技能を受け入れ", publicIntro: "清潔で安全な職場づくりに力を入れています。", note: "RAHASIA-CATATAN-KLIEN", ...over },
  fieldNames: ["飲食料品製造業", "外食業"],
  sites: [
    { name: "さくらフーズ 本社工場", address: "静岡県ダミー市工業団地5-5-5", phone: "00-0000-1004", accessNote: "JRダミー線「工業団地前駅」から送迎バス15分", note: "RAHASIA-CATATAN-LOKASI", contacts: [{ roleTitle: "工場長", name: "ダミー 三郎", phone: "00-0000-1104" }] },
    { name: "さくら食堂", address: "静岡県ダミー市中央6-6-6", phone: null, accessNote: null, note: null, contacts: [] },
  ],
  openings: [{ fieldName: "外食業", remaining: 2, minJlpt: "N4", jftRequired: true, targetStartDate: "2026-12-01", applicationDeadline: "2026-11-15", genderRequirement: "MALE" }],
});
const jobOrder = (over: Partial<JobOrderSheetData["jo"]> = {}): JobOrderSheetData => ({
  companyName: "さくらフーズ株式会社",
  site: { name: "さくらフーズ 本社工場", address: "静岡県ダミー市工業団地5-5-5", phone: "00-0000-1004", accessNote: "JRダミー線「工業団地前駅」から送迎バス15分", note: null, contacts: [{ roleTitle: "工場長", name: "ダミー 三郎", phone: "00-0000-1104" }] },
  fieldName: "飲食料品製造業",
  jo: {
    title: "食品工場 製造スタッフ", positions: 2, description: "惣菜の製造ラインでの調理補助。", workHours: "8:00〜17:00（休憩60分）", daysOff: "週休2日", monthlySalary: 195000, salaryNote: "残業手当別",
    housing: "allowance", housingNote: "家賃補助月2万円", commuteNote: "送迎バスあり", benefitsNote: "社会保険完備", minJlpt: "N4", jftRequired: false,
    targetStartDate: "2026-12-01", applicationDeadline: "2026-11-15", genderRequirement: "FEMALE", workPlace: null, note: "RAHASIA-CATATAN-JO", ...over,
  },
});

test("pemformat: gaji ¥ dengan pemisah ribuan, tanggal Jepang, syarat bahasa, tempat tinggal, jumlah karyawan, jenis kelamin", () => {
  assert.equal(formatSalaryYen(170000), "¥170,000 / 月");
  assert.equal(formatSalaryYen(1234567), "¥1,234,567 / 月");
  assert.equal(formatSalaryYen(0), "¥0 / 月");
  assert.equal(formatSalaryYen(220000, "jaid"), "¥220,000 / 月 (bulan)");
  assert.equal(formatYmd("2026-10-05"), "2026年10月5日");
  assert.equal(formatYmd(null), "");
  assert.equal(formatJpRequirement("N4", false, "ja"), "日本語能力試験 N4以上");
  assert.equal(formatJpRequirement("N3", true, "ja"), "日本語能力試験 N3以上、JFT-Basic 合格（200点以上）");
  assert.equal(formatJpRequirement(null, false, "ja"), "");
  assert.equal(formatHousing("provided", "個室", "ja"), "寮あり　個室");
  assert.equal(formatHousing(null, null, "ja"), "");
  assert.equal(formatHousing("none", null, "jaid"), "なし / Tidak ada");
  assert.equal(formatEmployees(1320), "1,320名");
  assert.equal(formatEmployees(null), "");
  assert.equal(formatGender("MALE", "ja"), "男性");
  assert.equal(formatGender(null, "ja"), "");
});

test("konfigurasi label: tiap bagian/kolom/pemeriksaan merujuk label yang ada; label dua bahasa 'Jepang / Indonesia'", () => {
  for (const kind of ["company", "jobOrder"] as const) for (const s of SECTIONS[kind]) assert.ok(s.label in LABELS, `label bagian ${s.id}`);
  for (const c of OPENING_COLUMNS) assert.ok(c.label in LABELS, `label kolom ${c.id}`);
  for (const [k, [ja, id]] of Object.entries(LABELS)) assert.ok(ja.length > 0 && id.length > 0, `pasangan label kosong: ${k}`);
  assert.equal(label("corporateName", "ja"), "法人名");
  assert.equal(label("corporateName", "jaid"), "法人名 / Nama badan usaha");
  assert.ok(COMPLETENESS.company.length > 0 && COMPLETENESS.jobOrder.length > 0 && SHARE_EXCLUDES.company.includes("staffName"));
});

test("profil klien: bagian kosong dilewati dan dicatat; perusahaan kosong hanya memuat nama", () => {
  const empty = buildCompanySheet({ company: { name: "北斗総合産業株式会社", hqAddress: null, industry: null, employeeCount: null, foreignWorkerExperience: null, publicIntro: null, note: null }, fieldNames: [], sites: [], openings: [] }, { mode: "share", lang: "ja" });
  assert.deepEqual(empty.sections.map((s) => s.id), ["basic"]);
  assert.deepEqual(empty.skipped, ["紹介文", "事業所", "求人"], "bagian kosong dicatat untuk pratinjau (internal-only tidak dihitung pada mode dibagikan)");
  assert.equal(empty.sections[0].kind === "kv" && empty.sections[0].rows.length, 1);
  assert.deepEqual(empty.missing, ["industry", "employeeCount", "foreignWorkerExperience", "publicIntro", "accessNote"]);
  const full = buildCompanySheet(company(), { mode: "internal", lang: "ja" });
  assert.deepEqual(full.sections.map((s) => s.id), ["basic", "intro", "sites", "openings", "internalNote"]);
  assert.deepEqual(full.missing, ["accessNote"], "satu lokasi belum punya akses");
});

test("mode dibagikan: tanpa telepon PIC, catatan internal, syarat jenis kelamin, nama staf; mode internal memuat semuanya", () => {
  const dump = (s: ReturnType<typeof buildCompanySheet>) => JSON.stringify(s);
  const share = dump(buildCompanySheet(company(), { mode: "share", lang: "ja", preparedBy: "Rina Staf TSK" }));
  const internal = dump(buildCompanySheet(company(), { mode: "internal", lang: "ja", preparedBy: "Rina Staf TSK" }));
  for (const bad of ["00-0000-1104", "RAHASIA-CATATAN-KLIEN", "RAHASIA-CATATAN-LOKASI", "男性", "性別条件", "Rina Staf TSK", "社内用"]) assert.ok(!share.includes(bad), `bocor di versi dibagikan: ${bad}`);
  assert.ok(share.includes("ダミー 三郎") && share.includes("工場長") && share.includes("提供用"), "nama dan jabatan PIC tetap ada");
  for (const good of ["00-0000-1104", "RAHASIA-CATATAN-KLIEN", "RAHASIA-CATATAN-LOKASI", "男性", "Rina Staf TSK", "社内用"]) assert.ok(internal.includes(good), `hilang di versi internal: ${good}`);
  const jShare = JSON.stringify(buildJobOrderSheet(jobOrder(), { mode: "share", lang: "ja", preparedBy: "Rina Staf TSK" }));
  const jInternal = JSON.stringify(buildJobOrderSheet(jobOrder(), { mode: "internal", lang: "ja", preparedBy: "Rina Staf TSK" }));
  for (const bad of ["00-0000-1104", "ダミー 三郎", "RAHASIA-CATATAN-JO", "女性", "Rina Staf TSK"]) assert.ok(!jShare.includes(bad), `bocor di lembar job order dibagikan: ${bad}`);
  for (const good of ["00-0000-1104", "ダミー 三郎", "RAHASIA-CATATAN-JO", "女性", "Rina Staf TSK"]) assert.ok(jInternal.includes(good), `hilang di lembar job order internal: ${good}`);
});

test("lembar job order: gaji ¥, tempat tinggal, bagian kosong dilewati; label dua bahasa", () => {
  const s = buildJobOrderSheet(jobOrder({ workHours: null, daysOff: null, commuteNote: null, benefitsNote: null, housing: null, housingNote: null, minJlpt: null, applicationDeadline: null, targetStartDate: null }), { mode: "share", lang: "ja" });
  const text = JSON.stringify(s);
  assert.ok(text.includes("¥195,000 / 月") && text.includes("残業手当別"));
  assert.ok(!text.includes("勤務時間") && !text.includes("休日・休暇") && !text.includes("通勤") && !text.includes("福利厚生") && !text.includes("住居"), "baris kosong dilewati");
  assert.ok(!s.sections.some((x) => x.id === "requirements"), "bagian persyaratan kosong dilewati pada mode dibagikan");
  assert.ok(s.skipped.includes("応募条件"));
  assert.ok(s.missing.includes("workHours") && s.missing.includes("housing") && !s.missing.includes("monthlySalary"));
  const bi = buildJobOrderSheet(jobOrder(), { mode: "internal", lang: "jaid" });
  assert.ok(JSON.stringify(bi).includes("勤務時間 / Jam kerja") && JSON.stringify(bi).includes("給与 / Gaji"));
  assert.ok(JSON.stringify(bi).includes("惣菜の製造ラインでの調理補助。"), "isi data bebas tidak diterjemahkan");
});

test("PDF profil klien: label Jepang, isi, mode, tanggal Tokyo, nomor halaman; versi dibagikan tidak memuat apa yang disembunyikan", async () => {
  const share = await renderSheetPdf(ctx, buildCompanySheet(company(), { mode: "share", lang: "ja", preparedBy: "Rina Staf TSK" }));
  assert.equal(share.buf.subarray(0, 5).toString(), "%PDF-");
  const r = await read(share.buf);
  const t = norm(r.text);
  for (const v of ["取引先プロフィール", "提供用", "基本情報", "法人名", "さくらフーズ株式会社", "業種・施設種別", "食品製造・外食", "従業員数", "320名", "外国人受入れ実績", "受入れ可能分野", "飲食料品製造業、外食業", "紹介文", "事業所", "最寄り駅・アクセス", "工業団地前駅", "担当者", "工場長ダミー三郎", "求人", "募集人数", "2名", "日本語能力試験N4以上", "2026年12月1日", "2026年11月15日"]) assert.ok(t.includes(norm(v)), `hilang di PDF: ${v}`);
  for (const bad of ["00-0000-1104", "RAHASIA", "男性", "性別条件", "Rina", "社内用", "備考（社内用）"]) assert.ok(!t.includes(norm(bad)), `bocor di PDF dibagikan: ${bad}`);
  assert.ok(t.includes("作成日時:2026/10/0514:20") && t.includes(`${r.n}/${r.n}`) && share.pages === r.n);
  assert.ok(share.buf.includes(Buffer.from("FontFile2")), "font Jepang tersemat");
  const internal = await renderSheetPdf(ctx, buildCompanySheet(company(), { mode: "internal", lang: "ja", preparedBy: "Rina Staf TSK" }));
  const ti = norm((await read(internal.buf)).text);
  for (const v of ["社内用", "00-0000-1104", "RAHASIA-CATATAN-KLIEN", "RAHASIA-CATATAN-LOKASI", "男性", "性別条件", "Rina Staf TSK", "備考（社内用）"]) assert.ok(ti.includes(norm(v)), `hilang di PDF internal: ${v}`);
});

test("PDF lembar job order dua bahasa: label ganda, gaji ¥, satu halaman; versi dibagikan tanpa PIC/catatan/gender", async () => {
  const pdf = await renderSheetPdf(ctx, buildJobOrderSheet(jobOrder(), { mode: "share", lang: "jaid", preparedBy: "Rina Staf TSK" }));
  const r = await read(pdf.buf);
  const t = norm(r.text);
  for (const v of ["求人票", "提供用/Untukdibagikan", "勤務時間/Jamkerja", "給与/Gaji", "¥195,000/月(bulan)", "住居/Tempattinggal", "住宅手当/Tunjanganperumahan", "家賃補助月2万円", "日本語要件/SyaratbahasaJepang", "食品工場製造スタッフ", "最寄り駅・アクセス/Stasiunterdekat/akses"]) assert.ok(t.includes(norm(v)), `hilang: ${v}`);
  for (const bad of ["00-0000-1104", "ダミー三郎", "RAHASIA", "女性", "性別条件", "Rina"]) assert.ok(!t.includes(norm(bad)), `bocor: ${bad}`);
  assert.equal(r.n, 1, "lembar job order muat satu halaman");
});
