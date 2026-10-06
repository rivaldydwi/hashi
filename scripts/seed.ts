// Isi database dengan data DEMO yang lengkap (bukan data asli). Semua nilai fiktif dan dibangkitkan dari PRNG ber-seed
// tetap (src/db/demo-data.ts), jadi reseed pada hari yang sama menghasilkan data identik (id, isi, dan berkas dokumen).
// Pemakaian: npm run db:seed          -> isi kalau database masih kosong
//            npm run db:seed -- --reset -> hapus semua data (dan berkas dokumen lama) dulu, lalu isi ulang
//
// Berjalan sebagai role OWNER (MIGRATE_DATABASE_URL) dengan bypass RLS.
// Berkas dokumen dummy ditulis ke STORAGE_DIR (bawaan ./docs-data), tata letak sama dengan unggahan asli.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { createDb, withSystem } from "../src/db";
import { assertTestDatabase } from "./db-guard";
import { periodMonthsAgo, currentPeriod, todayInAppTz, todayInTskTz } from "../src/db/time";
import { buildDemoAudit } from "../src/db/demo-audit";
import { buildAssessments, buildProfile, FIELD_JA, FIELD_KEYS, FIELDS, isIntentionallyIncomplete, sharedDaysAgo, type DemoProfile } from "../src/db/demo-data";
import { addDays, addMonths, uuidFor } from "../src/db/demo-rng";
import { seedClientSheet } from "../src/db/demo-client-sheet";
import { seedRecords } from "../src/db/demo-records";
import { clearDocumentStorage, demoAttachmentPath, demoDocumentPath, dummyPdf, dummyPng, storageRootFor, writeDemoFile } from "../src/db/demo-files";
import {
  candidates,
  auditLogs,
  candidateAssessments,
  candidateCertificates,
  candidateDocuments,
  candidateEducations,
  candidateFamilyMembers,
  candidateNotes,
  candidatePrivate,
  candidateSelections,
  candidateWorkHistories,
  clientCompanies,
  clientSiteContacts,
  clientSiteFields,
  clientSites,
  jobOrders,
  organizations,
  partnerships,
  skillFields,
  users,
  type CandidateStage,
  type SelectionDecision,
} from "../src/db/schema";

const PASSWORD = process.env.SEED_PASSWORD || "hashi-demo-2026";

const FIRST_NAMES: Array<[string, string, "MALE" | "FEMALE"]> = [
  ["Agus", "アグス", "MALE"],
  ["Budi", "ブディ", "MALE"],
  ["Dewi", "デウィ", "FEMALE"],
  ["Eka", "エカ", "FEMALE"],
  ["Fajar", "ファジャル", "MALE"],
  ["Gilang", "ギラン", "MALE"],
  ["Hendra", "ヘンドラ", "MALE"],
  ["Indah", "インダ", "FEMALE"],
  ["Joko", "ジョコ", "MALE"],
  ["Kurnia", "クルニア", "FEMALE"],
  ["Lestari", "レスタリ", "FEMALE"],
  ["Maya", "マヤ", "FEMALE"],
  ["Nanda", "ナンダ", "MALE"],
  ["Putri", "プトリ", "FEMALE"],
  ["Rizky", "リズキ", "MALE"],
  ["Sari", "サリ", "FEMALE"],
  ["Taufik", "タウフィック", "MALE"],
  ["Wahyu", "ワヒュ", "MALE"],
];

const LAST_NAMES: Array<[string, string]> = [
  ["Pratama", "プラタマ"],
  ["Saputra", "サプトラ"],
  ["Wijaya", "ウィジャヤ"],
  ["Hidayat", "ヒダヤット"],
  ["Nugroho", "ヌグロホ"],
  ["Santoso", "サントソ"],
  ["Kusuma", "クスマ"],
  ["Setiawan", "スティアワン"],
];

// Status LPK per indeks (12 kandidat per LPK). Status LPK hanya STUDYING / READY / WITHDRAWN; keputusan TSK terpisah
// (candidate_selections), jadi kandidat yang masih STUDYING pun bisa sudah di-shortlist TSK.
const STAGES: CandidateStage[] = ["STUDYING", "STUDYING", "STUDYING", "STUDYING", "READY", "READY", "READY", "READY", "READY", "READY", "READY", "WITHDRAWN"];

// Keputusan TSK per LPK mitra (indeks kandidat -> keputusan). Dirancang supaya SETIAP nilai keputusan punya >= 2 kandidat
// yang DIBAGIKAN ke TSK (lihat NOT_SHARED) dan keputusan lanjut hanya untuk kandidat berstatus Siap seleksi:
// SHORTLISTED 3, PASSED_TSK_INTERVIEW 2, SUBMITTED_TO_CLIENT 2, PASSED_CLIENT_INTERVIEW 2, DOCUMENT_PROCESS 2, DEPARTED 2,
// REJECTED 2, dan 6 kandidat terlihat belum diputuskan. LPK Medan (bukan mitra) tidak punya keputusan.
// Format: indeks -> keputusan, atau [keputusan, kode job order]. Keputusan PASSED_CLIENT_INTERVIEW / DOCUMENT_PROCESS / DEPARTED
// WAJIB punya job order (CHECK database); sisanya boleh umum atau dikaitkan ke job order sebidang (lihat DEMO_JOB_ORDERS).
type DecisionSpec = SelectionDecision | [SelectionDecision, string];
const DECISIONS: Record<number, Record<number, DecisionSpec>> = {
  0: { 1: "REJECTED", 3: "SHORTLISTED", 5: ["DOCUMENT_PROCESS", "agri"], 7: ["DEPARTED", "restaurant"], 8: "PASSED_TSK_INTERVIEW", 9: ["SUBMITTED_TO_CLIENT", "manufacture"], 10: ["PASSED_CLIENT_INTERVIEW", "construction"] },
  1: { 1: "REJECTED", 3: "SHORTLISTED", 4: "SHORTLISTED", 6: ["DOCUMENT_PROCESS", "agri"], 7: ["DEPARTED", "food"], 8: "PASSED_TSK_INTERVIEW", 9: ["SUBMITTED_TO_CLIENT", "kaigo"], 10: ["PASSED_CLIENT_INTERVIEW", "manufacture"] },
  2: {},
};

// Klien TSK demo (semua fiktif: telepon 00-xxxx-xxxx, alamat dummy). 3 perusahaan, 5 lokasi, bidang yang diterima beragam.
const DEMO_CLIENTS = [
  {
    name: "株式会社ひまわり介護", nameAlt: "Himawari Kaigo Co., Ltd.", corporateNumber: "0000000000001", hqAddress: "愛知県ダミー市中区ダミー町1-1-1", phone: "00-0000-0001", note: "ダミーデータ（デモ用）",
    sites: [
      { key: "S1", name: "特別養護老人ホーム ひまわり苑", address: "愛知県ダミー市北区ダミー2-2-2", phone: "00-0000-1001", fields: ["kaigo"], contacts: [["施設長", "ダミー 太郎", "00-0000-1101"], ["管理者", "ダミー 花子", "00-0000-1102"]] },
      { key: "S2", name: "ひまわりデイサービスセンター", address: "愛知県ダミー市南区ダミー3-3-3", phone: "00-0000-1002", fields: ["kaigo"], contacts: [["管理者", "ダミー 次郎", "00-0000-1103"]] },
    ],
  },
  {
    name: "さくらフーズ株式会社", nameAlt: "Sakura Foods Co., Ltd.", corporateNumber: "0000000000002", hqAddress: "静岡県ダミー市ダミー町4-4-4", phone: "00-0000-0002", note: "ダミーデータ（デモ用）",
    sites: [
      { key: "S3", name: "さくらフーズ 本社工場", address: "静岡県ダミー市工業団地5-5-5", phone: "00-0000-1004", fields: ["food", "manufacture"], contacts: [["工場長", "ダミー 三郎", "00-0000-1104"], ["人事担当", "ダミー 美咲", "00-0000-1105"]] },
      { key: "S4", name: "さくら食堂 外食事業部", address: "静岡県ダミー市中央6-6-6", phone: "00-0000-1005", fields: ["restaurant", "food"], contacts: [["店長", "ダミー 四郎", "00-0000-1106"]] },
    ],
  },
  {
    name: "北斗総合産業株式会社", nameAlt: "Hokuto Sogo Sangyo K.K.", corporateNumber: "0000000000003", hqAddress: "岐阜県ダミー市ダミー町7-7-7", phone: "00-0000-0003", note: "ダミーデータ（デモ用）",
    sites: [
      { key: "S5", name: "北斗総合産業 名古屋事業所", address: "愛知県ダミー市西区ダミー8-8-8", phone: "00-0000-1007", fields: ["construction", "agri"], contacts: [["現場監督", "ダミー 五郎", "00-0000-1107"], ["総務", "ダミー 彩", "00-0000-1108"]] },
    ],
  },
] as const;

// Job order demo: status awal OPEN (FILLED otomatis oleh trigger bila terpilih >= posisi), kecuali yang sengaja CLOSED.
// Kunci = kode bidang dipakai juga sebagai kunci DecisionSpec di atas.
const DEMO_JOB_ORDERS = [
  { key: "kaigo", site: "S1", title: "介護職員（特別養護老人ホーム）", positions: 3, program: "SSW", status: "OPEN", minJlpt: "N4", jft: false, gender: null, salary: 210000, start: "+120", deadline: "+60", description: "入居者の身体介護・生活支援。夜勤は月4回程度。", salaryNote: "月給21万円（夜勤手当別）、寮完備" },
  { key: "food", site: "S3", title: "食品工場 製造スタッフ", positions: 2, program: "SSW", status: "OPEN", minJlpt: "N5", jft: false, gender: null, salary: 195000, start: "-60", deadline: "-90", description: "惣菜の製造ラインでの調理補助・盛り付け・衛生管理。", salaryNote: "月給19.5万円、社宅あり" },
  { key: "restaurant", site: "S4", title: "ホール・キッチンスタッフ", positions: 2, program: "SSW", status: "OPEN", minJlpt: "N4", jft: false, gender: null, salary: 200000, start: "-45", deadline: "-80", description: "接客、配膳、簡単な調理。", salaryNote: "月給20万円、まかないあり" },
  { key: "manufacture", site: "S3", title: "金属プレス加工オペレーター", positions: 1, program: "SSW", status: "OPEN", minJlpt: "N4", jft: true, gender: "MALE", salary: 220000, start: "+30", deadline: "-10", description: "プレス機の操作・検査・簡単な保全。", salaryNote: "月給22万円、残業手当別" },
  { key: "construction", site: "S5", title: "型枠大工（見習い）", positions: 2, program: "SSW", status: "CLOSED", minJlpt: "N4", jft: false, gender: "MALE", salary: 230000, start: "+90", deadline: "-20", description: "型枠の加工・組立補助。", salaryNote: "月給23万円、現場手当あり" },
  { key: "agri", site: "S5", title: "施設園芸スタッフ", positions: 3, program: "SSW", status: "OPEN", minJlpt: "N4", jft: true, gender: null, salary: 190000, start: "+75", deadline: "+45", description: "ハウス栽培の播種・収穫・出荷作業。", salaryNote: "月給19万円、寮費補助あり" },
] as const;

// Berbagi ke TSK (candidates.shared_with_tsk) per LPK, berdasarkan indeks kandidat.
// TSK demo hanya melihat yang dibagikan: LPK Bandung menahan 2 kandidat READY, LPK Surabaya 1 READY,
// sehingga TSK melihat 21 dari 24. LPK Medan (bukan mitra) membagikan semuanya, supaya tes "LPK non-mitra
// tidak terlihat" benar-benar menguji kemitraan, bukan opsi berbagi.
const NOT_SHARED: Record<number, number[]> = { 0: [4, 6], 1: [5], 2: [] };
// Tanggal formulir persetujuan hanya catatan dan TIDAK menentukan visibilitas: sengaja dikosongkan
// untuk 1 kandidat yang DIBAGIKAN (LPK Bandung, indeks 8) dan dibiarkan terisi untuk 1 yang tidak dibagikan.
const NO_CONSENT_DATE: Record<number, number[]> = { 0: [8], 1: [], 2: [] };

const ORG_NAMES = ["LPK Demo Bandung", "LPK Demo Surabaya", "LPK Non-Mitra Medan"];
const OFFSETS = [0, 5, 11];

function candidateRows(orgId: string, orgIndex: number, today: string, fieldIds: Record<string, string>) {
  const offset = OFFSETS[orgIndex];
  return STAGES.map((stage, i) => {
    const [first, firstKana, gender] = FIRST_NAMES[(i + offset) % FIRST_NAMES.length];
    const [last, lastKana] = LAST_NAMES[(i * 3 + offset) % LAST_NAMES.length];
    const year = 1998 + ((i + offset) % 8);
    const month = String(((i * 5 + offset) % 12) + 1).padStart(2, "0");
    const birthDate = `${year}-${month}-15`;
    const fieldIndex = (i + offset) % FIELDS.length;
    const fullName = `${first} ${last}`;
    const profile = buildProfile({ orgIndex, i, stage, gender, fullName, firstName: first, lastName: last, birthDate, fieldIndex, today });
    return {
      orgIndex,
      i,
      profile,
      decision: DECISIONS[orgIndex][i],
      row: {
        id: uuidFor(`candidate:${orgIndex}:${i}`),
        organizationId: orgId,
        fullName,
        nameKatakana: `${firstKana}・${lastKana}`,
        gender,
        birthDate,
        fieldId: fieldIds[FIELD_KEYS[fieldIndex % FIELD_KEYS.length]],
        stage,
        dataConsentDate: NO_CONSENT_DATE[orgIndex].includes(i) ? null : `2026-${String(((i + offset) % 6) + 1).padStart(2, "0")}-10`,
        sharedWithTsk: !NOT_SHARED[orgIndex].includes(i),
        ...profile.candidatePatch,
        ...(isIntentionallyIncomplete(orgIndex, i) ? { hobby: null, specialSkill: null } : {}),
      },
    };
  });
}

// Catatan TSK demo: [orgIndex, indeks, visibilitas, penulis(admin|staff), isi]. Campuran Jepang (admin) dan Indonesia (staf).
const TSK_NOTES: Array<[number, number, "TSK_ONLY" | "SHARED_WITH_LPK", "admin" | "staff", string]> = [
  [0, 3, "TSK_ONLY", "admin", "面談メモ：日本語の聞き取りは良好。介護分野の経験について追加で確認したい。"],
  [0, 5, "SHARED_WITH_LPK", "staff", "Mohon perbarui foto paspor dan kirim ulang scan halaman identitas sebelum proses dokumen berlanjut."],
  [0, 7, "TSK_ONLY", "staff", "Sudah berangkat sesuai jadwal. Pantau kabar dari perusahaan penerima bulan depan."],
  [0, 8, "SHARED_WITH_LPK", "admin", "面談メモ：健康診断書の再提出をお願いします。"],
  [0, 9, "TSK_ONLY", "admin", "面談メモ：クライアントの印象は良い。条件面の希望（寮・残業）を確認する。"],
  [0, 9, "SHARED_WITH_LPK", "staff", "Berkas sudah diajukan ke client. Mohon siapkan kandidat untuk wawancara online minggu depan."],
  [0, 10, "SHARED_WITH_LPK", "admin", "クライアント面接に合格。次は在留資格認定証明書の手続きに進みます。"],
  [1, 3, "TSK_ONLY", "staff", "Semangat tinggi, tetapi bahasa Jepang masih perlu diperkuat sebelum wawancara."],
  [1, 6, "TSK_ONLY", "admin", "書類審査中。パスポートの有効期限に注意。"],
  [1, 8, "SHARED_WITH_LPK", "staff", "Wawancara TSK berjalan baik. Mohon lengkapi surat izin keluarga."],
  [1, 10, "TSK_ONLY", "admin", "面談メモ：経験は十分。クライアント提出の候補に推薦する。"],
];

// Penilaian TSK demo: [orgIndex, indeks, jenis, hariLalu, visibilitas, penulis, skor J/A/F/M, catatan]
const TSK_ASSESSMENTS: Array<[number, number, "TSK_VISIT" | "TSK_INTERVIEW", number, "TSK_ONLY" | "SHARED_WITH_LPK", "admin" | "staff", [number, number, number, number], string]> = [
  [0, 3, "TSK_VISIT", 40, "TSK_ONLY", "staff", [3, 4, 4, 4], "Kunjungan ke LPK: kelas tertib, siswa antusias."],
  [0, 5, "TSK_VISIT", 25, "SHARED_WITH_LPK", "staff", [4, 4, 4, 4], "Bertemu langsung di LPK: komunikasi baik."],
  [0, 8, "TSK_VISIT", 33, "TSK_ONLY", "admin", [4, 4, 5, 4], "Kunjungan: kondisi asrama bersih dan teratur."],
  [0, 7, "TSK_INTERVIEW", 70, "TSK_ONLY", "admin", [4, 4, 4, 5], "面談 TSK: motivasi tinggi."],
  [0, 8, "TSK_INTERVIEW", 20, "TSK_ONLY", "admin", [4, 4, 4, 5], "面談 TSK: motivasi tinggi, pelafalan perlu diperhalus."],
  [0, 9, "TSK_INTERVIEW", 14, "SHARED_WITH_LPK", "admin", [5, 4, 4, 5], "面談 TSK: layak diajukan ke client."],
  [0, 10, "TSK_INTERVIEW", 9, "SHARED_WITH_LPK", "staff", [5, 5, 4, 5], "Interview TSK: sangat siap, jawaban jelas dan percaya diri."],
  [1, 3, "TSK_VISIT", 30, "TSK_ONLY", "staff", [3, 3, 4, 4], "Kunjungan: perlu tambahan jam percakapan."],
  [1, 4, "TSK_VISIT", 18, "SHARED_WITH_LPK", "admin", [4, 4, 4, 4], "Kunjungan: perkembangan baik sejak bulan lalu."],
  [1, 8, "TSK_INTERVIEW", 26, "TSK_ONLY", "admin", [4, 4, 5, 4], "面談 TSK: kuat di bidang praktik."],
  [1, 9, "TSK_INTERVIEW", 12, "SHARED_WITH_LPK", "staff", [4, 5, 4, 4], "Interview TSK: lanjut ke tahap pengajuan client."],
  [1, 10, "TSK_INTERVIEW", 6, "TSK_ONLY", "admin", [5, 4, 4, 5], "面談 TSK: pengalaman kerja relevan, rekomendasi kuat."],
];

const DOC_TYPES = [
  { type: "PASSPORT", file: "paspor", ext: "pdf", label: "Paspor" },
  { type: "DIPLOMA", file: "ijazah", ext: "pdf", label: "Ijazah" },
  { type: "PHOTO", file: "foto", ext: "png", label: "Pas foto" },
  { type: "MEDICAL_CHECKUP", file: "medical-checkup", ext: "pdf", label: "Medical check-up" },
] as const;

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set");
  const reset = process.argv.includes("--reset");
  // --reset menghapus SEMUA data: hanya boleh di database dev/test/demo
  if (reset) assertTestDatabase("db:seed --reset");

  const { db, pool } = createDb(url, 1);
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const today = todayInAppTz();
  const root = storageRootFor();
  const files: Array<{ path: string; data: Buffer }> = [];
  let summary = "";

  await withSystem(async (tx) => {
    const existing = await tx.select({ id: organizations.id }).from(organizations).limit(1);
    if (existing.length > 0 && !reset) {
      console.log("ℹ Database sudah berisi data. Lewati seed (pakai --reset untuk mengisi ulang).");
      return;
    }
    if (reset) {
      console.log("⚠ --reset: menghapus semua data...");
      // TRUNCATE tidak memicu trigger BEFORE DELETE per baris (mis. penjaga hapus kandidat), jadi reset tidak terhalang aturan blokir.
      await tx.execute(sql`truncate table audit_logs, candidates, users, partnerships, organizations restart identity cascade`);
    }
    const removed = await clearDocumentStorage(root);
    if (removed > 0) console.log(`⚠ Berkas dokumen lama dihapus (${removed} folder organisasi di ${root}).`);

    const orgId = (name: string) => uuidFor(`org:${name}`);
    const [platform, tsk, lpk1, lpk2, lpk3] = await tx
      .insert(organizations)
      .values([
        { id: orgId("Hashi Platform"), name: "Hashi Platform", type: "PLATFORM", country: "JP", defaultLocale: "id" },
        { id: orgId("TSK Demo Tokyo"), name: "TSK Demo Tokyo", type: "TSK", country: "JP", defaultLocale: "ja", timezone: "Asia/Tokyo" },
        { id: orgId(ORG_NAMES[0]), name: ORG_NAMES[0], type: "LPK", country: "ID", defaultLocale: "id" },
        { id: orgId(ORG_NAMES[1]), name: ORG_NAMES[1], type: "LPK", country: "ID", defaultLocale: "id" },
        { id: orgId(ORG_NAMES[2]), name: ORG_NAMES[2], type: "LPK", country: "ID", defaultLocale: "id" },
      ])
      .returning();

    // LPK Medan sengaja TIDAK bermitra dengan TSK, untuk menguji isolasi data.
    await tx.insert(partnerships).values([
      { lpkId: lpk1.id, tskId: tsk.id },
      { lpkId: lpk2.id, tskId: tsk.id },
    ]);

    const U = (email: string) => uuidFor(`user:${email}`);
    await tx.insert(users).values([
      { id: U("admin@hashi.test"), organizationId: platform.id, email: "admin@hashi.test", name: "Super Admin", role: "SUPER_ADMIN", locale: "id", languages: ["id", "en"], passwordHash },
      { id: U("tsk.admin@hashi.test"), organizationId: tsk.id, email: "tsk.admin@hashi.test", name: "田中 一郎", role: "TSK_ADMIN", locale: "ja", languages: ["ja", "id", "en"], passwordHash },
      { id: U("tsk.staff@hashi.test"), organizationId: tsk.id, email: "tsk.staff@hashi.test", name: "Rina Staf TSK", role: "TSK_STAFF", locale: "id", languages: ["ja", "id"], passwordHash },
      { id: U("lpk1.admin@hashi.test"), organizationId: lpk1.id, email: "lpk1.admin@hashi.test", name: "Admin LPK Bandung", role: "LPK_ADMIN", locale: "id", languages: ["id", "en"], passwordHash },
      { id: U("lpk1.sensei@hashi.test"), organizationId: lpk1.id, email: "lpk1.sensei@hashi.test", name: "Sensei Bandung", role: "LPK_SENSEI", locale: "id", languages: ["id", "ja"], passwordHash },
      { id: U("lpk2.admin@hashi.test"), organizationId: lpk2.id, email: "lpk2.admin@hashi.test", name: "Admin LPK Surabaya", role: "LPK_ADMIN", locale: "id", languages: ["id", "en"], passwordHash },
      { id: U("lpk3.admin@hashi.test"), organizationId: lpk3.id, email: "lpk3.admin@hashi.test", name: "Admin LPK Medan", role: "LPK_ADMIN", locale: "id", languages: ["id", "en"], passwordHash },
    ]);

    const orgs = [lpk1, lpk2, lpk3];
    // Bidang kerja (master): dari migration 0014; dilengkapi bila belum ada (mis. database yang dibuat tanpa migration data)
    await tx
      .insert(skillFields)
      .values(FIELD_KEYS.map((code, i) => ({ code, nameId: FIELDS[i], nameJa: FIELD_JA[i], sortOrder: (i + 1) * 10 })))
      .onConflictDoNothing({ target: skillFields.code });
    const fieldIds = Object.fromEntries((await tx.select({ id: skillFields.id, code: skillFields.code }).from(skillFields)).map((r) => [r.code, r.id]));
    const seeded = orgs.flatMap((o, orgIndex) => candidateRows(o.id, orgIndex, today, fieldIds));
    await tx.insert(candidates).values(seeded.map((c) => c.row));
    // Waktu berbagi bervariasi (trigger hanya mengisinya saat UPDATE OF shared_with_tsk, jadi di sini boleh diubah langsung)
    for (const c of seeded.filter((x) => x.row.sharedWithTsk)) {
      await tx.update(candidates).set({ sharedWithTskAt: new Date(Date.now() - sharedDaysAgo(c.orgIndex, c.i) * 86_400_000) }).where(eq(candidates.id, c.row.id));
    }

    // ---- Data sensitif, keluarga, pendidikan, kerja, sertifikat
    await tx.insert(candidatePrivate).values(seeded.map((c) => ({ candidateId: c.row.id, ...c.profile.private })));
    await tx.insert(candidateFamilyMembers).values(seeded.flatMap((c) => c.profile.family.map((f) => ({ candidateId: c.row.id, ...f }))));
    await tx.insert(candidateEducations).values(seeded.flatMap((c) => c.profile.educations.map((e) => ({ candidateId: c.row.id, ...e }))));
    await tx.insert(candidateWorkHistories).values(seeded.flatMap((c) => c.profile.works.map((w) => ({ candidateId: c.row.id, ...w }))));
    await tx.insert(candidateCertificates).values(seeded.flatMap((c) => c.profile.certificates.map((x) => ({ candidateId: c.row.id, ...x }))));

    // ---- Dokumen dummy (metadata + berkas; berkas ditulis setelah transaksi selesai)
    const pdfs = new Map(DOC_TYPES.filter((d) => d.ext === "pdf").map((d) => [d.type, dummyPdf(d.label)]));
    const png = dummyPng();
    const adminOf = (orgIndex: number) => U(["lpk1.admin@hashi.test", "lpk2.admin@hashi.test", "lpk3.admin@hashi.test"][orgIndex]);
    const docRows: Array<typeof candidateDocuments.$inferInsert> = [];
    for (const c of seeded) {
      const pr: DemoProfile["private"] = c.profile.private;
      for (const d of DOC_TYPES) {
        const id = uuidFor(`doc:${c.row.id}:${d.type}`);
        const data = d.ext === "png" ? png : pdfs.get(d.type)!;
        docRows.push({
          id,
          candidateId: c.row.id,
          type: d.type,
          originalFilename: `${d.file}-${c.row.fullName.toLowerCase().replace(/\s+/g, "-")}.${d.ext}`,
          mimeType: d.ext === "png" ? "image/png" : "application/pdf",
          sizeBytes: data.length,
          issuedDate: d.type === "PASSPORT" ? pr.passportIssuedDate : d.type === "DIPLOMA" ? c.profile.diplomaDate : d.type === "MEDICAL_CHECKUP" ? c.profile.mcuDate : addDays(today, -60),
          expiryDate: d.type === "PASSPORT" ? pr.passportExpiryDate : d.type === "MEDICAL_CHECKUP" ? addMonths(c.profile.mcuDate, 6) : null,
          uploadedBy: adminOf(c.orgIndex),
        });
        files.push({ path: demoDocumentPath(root, c.row.organizationId, c.row.id, id, d.ext), data });
      }
    }
    await tx.insert(candidateDocuments).values(docRows);

    // ---- Keputusan TSK (hanya LPK mitra)
    const tskAdminId = U("tsk.admin@hashi.test");
    const tskStaffId = U("tsk.staff@hashi.test");
    const tskUser = (who: "admin" | "staff") => (who === "admin" ? tskAdminId : tskStaffId);
    const byKey = new Map(seeded.map((c) => [`${c.orgIndex}.${c.i}`, c]));
    const decided = seeded.filter((c) => c.decision);
    const decisionOf = (spec: DecisionSpec | undefined): SelectionDecision | undefined => (Array.isArray(spec) ? spec[0] : spec);

    // ---- Klien TSK: perusahaan, lokasi (+ bidang yang diterima), PIC; lalu job order
    const orgIdTsk = tsk.id;
    const siteIds = new Map<string, string>();
    const siteAddress = new Map<string, string>();
    let companyCount = 0;
    let siteCount = 0;
    for (const [ci, co] of DEMO_CLIENTS.entries()) {
      const companyId = uuidFor(`client:company:${ci}`);
      await tx.insert(clientCompanies).values({ id: companyId, orgId: orgIdTsk, name: co.name, nameAlt: co.nameAlt, corporateNumber: co.corporateNumber, hqAddress: co.hqAddress, phone: co.phone, note: co.note });
      companyCount++;
      for (const site of co.sites) {
        const siteId = uuidFor(`client:site:${site.key}`);
        siteIds.set(site.key, siteId);
        siteAddress.set(site.key, site.address);
        await tx.insert(clientSites).values({ id: siteId, orgId: orgIdTsk, companyId, name: site.name, address: site.address, phone: site.phone, note: "ダミーデータ（デモ用）" });
        await tx.insert(clientSiteFields).values(site.fields.map((code) => ({ siteId, fieldId: fieldIds[code], orgId: orgIdTsk })));
        await tx.insert(clientSiteContacts).values(site.contacts.map(([roleTitle, name, phone]) => ({ orgId: orgIdTsk, siteId, roleTitle, name, phone })));
        siteCount++;
      }
    }
    const shiftDays = (offset: string) => addDays(today, Number(offset));
    const jobOrderIds = new Map<string, string>();
    for (const jo of DEMO_JOB_ORDERS) {
      const id = uuidFor(`client:job-order:${jo.key}`);
      jobOrderIds.set(jo.key, id);
      await tx.insert(jobOrders).values({
        id, orgId: orgIdTsk, siteId: siteIds.get(jo.site)!, fieldId: fieldIds[jo.key], title: jo.title, positions: jo.positions, program: jo.program, status: jo.status,
        description: jo.description, salaryNote: jo.salaryNote, monthlySalary: jo.salary, workPlace: siteAddress.get(jo.site)!,
        minJlpt: jo.minJlpt, jftRequired: jo.jft, genderRequirement: jo.gender, targetStartDate: shiftDays(jo.start), applicationDeadline: shiftDays(jo.deadline), note: "ダミーデータ（デモ用）",
      });
    }

    // ---- Informasi untuk lembar klien (langkah 6): kolom baru perusahaan/lokasi/job order (satu perusahaan dan satu job order sengaja tidak lengkap)
    await seedClientSheet(tx);

    // ---- Keputusan TSK (hanya LPK mitra); yang punya kode job order dikaitkan ke job order sebidang
    await tx.insert(candidateSelections).values(
      decided.map((c) => {
        const spec = c.decision as DecisionSpec;
        const jobKey = Array.isArray(spec) ? spec[1] : null;
        return { candidateId: c.row.id, tskOrgId: tsk.id, decision: decisionOf(spec)!, jobOrderId: jobKey ? jobOrderIds.get(jobKey)! : null, decidedBy: tskAdminId };
      }),
    );

    await tx.insert(candidateNotes).values(
      TSK_NOTES.map(([o, i, visibility, who, body]) => ({ candidateId: byKey.get(`${o}.${i}`)!.row.id, tskOrgId: tsk.id, authorId: tskUser(who), body, visibility })),
    );

    // ---- Penilaian bulanan LPK (3-6 per kandidat, ~40% belum dinilai bulan ini)
    const staff: Record<number, string[]> = {
      0: [U("lpk1.admin@hashi.test"), U("lpk1.sensei@hashi.test")],
      1: [U("lpk2.admin@hashi.test")],
      2: [U("lpk3.admin@hashi.test")],
    };
    const lpkRows: Array<typeof candidateAssessments.$inferInsert> = [];
    for (const c of seeded) {
      const list = buildAssessments({ orgIndex: c.orgIndex, i: c.i, stage: c.row.stage, bestJlpt: c.profile.bestJlpt, today, currentPeriod: currentPeriod(), periodOf: (n) => periodMonthsAgo(n) });
      for (const a of list) {
        const { assessorSlot, ...rest } = a;
        lpkRows.push({ candidateId: c.row.id, orgId: c.row.organizationId, kind: "LPK_MONTHLY", assessorId: staff[c.orgIndex][assessorSlot % staff[c.orgIndex].length], ...rest });
      }
    }
    await tx.insert(candidateAssessments).values(lpkRows);

    // ---- Penilaian TSK (kunjungan kapan saja; interview hanya untuk keputusan yang membukanya)
    const interviewOk = new Set<SelectionDecision>(["PASSED_TSK_INTERVIEW", "SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"]);
    const tskRows = TSK_ASSESSMENTS.map(([o, i, kind, daysAgo, visibility, who, [sj, sa, sf, sm], note]) => {
      const c = byKey.get(`${o}.${i}`)!;
      if (kind === "TSK_INTERVIEW" && !(c.decision && interviewOk.has(decisionOf(c.decision as DecisionSpec)!))) throw new Error(`interview TSK tidak sesuai keputusan untuk ${o}.${i}`);
      return {
        candidateId: c.row.id,
        orgId: tsk.id,
        kind,
        assessedOn: addDays(today, -daysAgo),
        assessorId: tskUser(who),
        durationMinutes: kind === "TSK_VISIT" ? 60 : 45,
        scoreJapanese: sj,
        scoreAttitude: sa,
        scoreFitness: sf,
        scoreMotivation: sm,
        note,
        followUp: kind === "TSK_INTERVIEW" ? "Lanjut sesuai keputusan TSK; kabari LPK bila ada dokumen tambahan." : null,
        visibility,
      } satisfies typeof candidateAssessments.$inferInsert;
    });
    await tx.insert(candidateAssessments).values(tskRows);

    // ---- Riwayat aktivitas demo (~30 entri per organisasi; entri lintas organisasi tanpa nama orang)
    const auditRows = buildDemoAudit({
      now: new Date(),
      lpks: [lpk1, lpk2, lpk3].map((o) => ({ id: o.id, name: o.name })),
      tsk: { id: tsk.id, name: tsk.name },
      users: [
        { id: U("tsk.admin@hashi.test"), name: "田中 一郎", role: "TSK_ADMIN", orgId: tsk.id },
        { id: U("tsk.staff@hashi.test"), name: "Rina Staf TSK", role: "TSK_STAFF", orgId: tsk.id },
        { id: U("lpk1.admin@hashi.test"), name: "Admin LPK Bandung", role: "LPK_ADMIN", orgId: lpk1.id },
        { id: U("lpk1.sensei@hashi.test"), name: "Sensei Bandung", role: "LPK_SENSEI", orgId: lpk1.id },
        { id: U("lpk2.admin@hashi.test"), name: "Admin LPK Surabaya", role: "LPK_ADMIN", orgId: lpk2.id },
        { id: U("lpk3.admin@hashi.test"), name: "Admin LPK Medan", role: "LPK_ADMIN", orgId: lpk3.id },
      ],
      cands: seeded.map((c) => ({ id: c.row.id, orgIndex: c.orgIndex, i: c.i, stage: c.row.stage })),
    });
    await tx.insert(auditLogs).values(auditRows);

    // ---- Catatan kegiatan TSK (langkah 7A): catatan, kasus, tugas, laporan harian, wawancara berkala, lampiran
    const recRes = await seedRecords(tx, { today: todayInTskTz(), passwordHash }, dummyPng);
    for (const f of recRes.files) files.push({ path: demoAttachmentPath(root, f.orgId, f.id, f.ext), data: f.data });
    for (const n of recRes.notes) console.log(`ℹ ${n}`);

    summary = `✓ Seed selesai: 5 organisasi, 7 pengguna, ${seeded.length} kandidat demo lengkap (3 tidak dibagikan ke TSK, 1 dibagikan tanpa tanggal formulir), ${decided.length} keputusan TSK, ${companyCount} perusahaan klien dengan ${siteCount} lokasi dan ${DEMO_JOB_ORDERS.length} job order, ${TSK_NOTES.length} catatan TSK, ${lpkRows.length} penilaian bulanan LPK + ${tskRows.length} penilaian TSK, ${docRows.length} dokumen dummy, ${auditRows.length} entri riwayat aktivitas, catatan kegiatan (${recRes.summary["records.daily"]} harian, ${recRes.summary["records.meeting"]} notulen, ${recRes.summary.cases} kasus, ${recRes.summary.followups} tugas, ${recRes.summary.interviews} wawancara berkala)`;
  }, db);

  if (files.length > 0) {
    for (const f of files) await writeDemoFile(f.path, f.data);
    console.log(`✓ ${files.length} berkas dokumen dummy ditulis ke ${root}`);
  }
  if (summary) {
    console.log(summary);
    console.log(`  Password semua akun demo: ${PASSWORD}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error("✗ Seed gagal:", err);
  process.exit(1);
});
