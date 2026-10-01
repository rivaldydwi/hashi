// Isi database dengan data DEMO (bukan data asli).
// Pemakaian: npm run db:seed          -> isi kalau database masih kosong
//            npm run db:seed -- --reset -> hapus semua data dulu, lalu isi ulang
//
// Berjalan sebagai role OWNER (MIGRATE_DATABASE_URL) dengan bypass RLS.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { createDb, withSystem } from "../src/db";
import { assertTestDatabase } from "./db-guard";
import { periodMonthsAgo, todayInAppTz } from "../src/db/time";
import { randomUUID } from "node:crypto";
import {
  candidates,
  candidateAssessments,
  candidateNotes,
  candidateSelections,
  organizations,
  partnerships,
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

const FIELDS = [
  "Pengolahan makanan & minuman",
  "Jasa makanan (restoran)",
  "Perawatan lansia (kaigo)",
  "Manufaktur industri",
  "Konstruksi",
  "Pertanian",
];

// Sebaran per LPK (12 kandidat): status di LPK + keputusan TSK mitra (kalau ada).
// Status LPK hanya STUDYING / READY / WITHDRAWN; keputusan TSK terpisah (candidate_selections),
// jadi kandidat yang masih STUDYING pun bisa sudah di-shortlist TSK.
const PIPELINE: Array<{ stage: CandidateStage; decision?: SelectionDecision }> = [
  { stage: "STUDYING" },
  { stage: "STUDYING" },
  { stage: "STUDYING" },
  { stage: "STUDYING", decision: "SHORTLISTED" },
  { stage: "READY" }, // LPK Bandung: indeks 4 dan 6 tidak dibagikan ke TSK (lihat NOT_SHARED)
  { stage: "READY" },
  { stage: "READY" },
  { stage: "READY", decision: "SHORTLISTED" },
  { stage: "READY", decision: "PASSED_TSK_INTERVIEW" },
  { stage: "READY", decision: "SUBMITTED_TO_CLIENT" },
  { stage: "READY", decision: "PASSED_CLIENT_INTERVIEW" },
  { stage: "WITHDRAWN" },
];

// Berbagi ke TSK (candidates.shared_with_tsk) per LPK, berdasarkan indeks kandidat di PIPELINE.
// TSK demo hanya melihat yang dibagikan: LPK Bandung menahan 2 kandidat READY, LPK Surabaya 1 READY,
// sehingga TSK melihat 21 dari 24. LPK Medan (bukan mitra) membagikan semuanya, supaya tes "LPK non-mitra
// tidak terlihat" benar-benar menguji kemitraan, bukan opsi berbagi.
const NOT_SHARED: Record<number, number[]> = { 0: [4, 6], 1: [5], 2: [] };
// Tanggal formulir persetujuan hanya catatan dan TIDAK menentukan visibilitas: sengaja dikosongkan
// untuk 1 kandidat yang DIBAGIKAN (LPK Bandung, indeks 8) dan dibiarkan terisi untuk 1 yang tidak dibagikan.
const NO_CONSENT_DATE: Record<number, number[]> = { 0: [8], 1: [], 2: [] };

function candidateRows(orgId: string, offset: number, orgIndex: number) {
  return PIPELINE.map(({ stage, decision }, i) => {
    const [first, firstKana, gender] = FIRST_NAMES[(i + offset) % FIRST_NAMES.length];
    const [last, lastKana] = LAST_NAMES[(i * 3 + offset) % LAST_NAMES.length];
    const year = 1998 + ((i + offset) % 8);
    const month = String(((i * 5 + offset) % 12) + 1).padStart(2, "0");
    return {
      decision,
      row: {
        id: randomUUID(),
        organizationId: orgId,
        fullName: `${first} ${last}`,
        nameKatakana: `${firstKana}・${lastKana}`,
        gender,
        birthDate: `${year}-${month}-15`,
        field: FIELDS[(i + offset) % FIELDS.length],
        stage,
        dataConsentDate: NO_CONSENT_DATE[orgIndex].includes(i)
          ? null
          : `2026-${String(((i + offset) % 6) + 1).padStart(2, "0")}-10`,
        sharedWithTsk: !NOT_SHARED[orgIndex].includes(i),
      },
    };
  });
}

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set");
  const reset = process.argv.includes("--reset");
  // --reset menghapus SEMUA data: hanya boleh di database dev/test
  if (reset) assertTestDatabase("db:seed --reset");

  const { db, pool } = createDb(url, 1);
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  await withSystem(async (tx) => {
    const existing = await tx.select({ id: organizations.id }).from(organizations).limit(1);
    if (existing.length > 0 && !reset) {
      console.log("ℹ Database sudah berisi data. Lewati seed (pakai --reset untuk mengisi ulang).");
      return;
    }
    if (reset) {
      console.log("⚠ --reset: menghapus semua data...");
      await tx.execute(
        sql`truncate table audit_logs, candidates, users, partnerships, organizations restart identity cascade`,
      );
    }

    const [platform, tsk, lpk1, lpk2, lpk3] = await tx
      .insert(organizations)
      .values([
        { name: "Hashi Platform", type: "PLATFORM", country: "JP", defaultLocale: "id" },
        { name: "TSK Demo Tokyo", type: "TSK", country: "JP", defaultLocale: "ja" },
        { name: "LPK Demo Bandung", type: "LPK", country: "ID", defaultLocale: "id" },
        { name: "LPK Demo Surabaya", type: "LPK", country: "ID", defaultLocale: "id" },
        { name: "LPK Non-Mitra Medan", type: "LPK", country: "ID", defaultLocale: "id" },
      ])
      .returning();

    // LPK Medan sengaja TIDAK bermitra dengan TSK, untuk menguji isolasi data.
    await tx.insert(partnerships).values([
      { lpkId: lpk1.id, tskId: tsk.id },
      { lpkId: lpk2.id, tskId: tsk.id },
    ]);

    await tx.insert(users).values([
      { organizationId: platform.id, email: "admin@hashi.test", name: "Super Admin", role: "SUPER_ADMIN", locale: "id", passwordHash },
      { organizationId: tsk.id, email: "tsk.admin@hashi.test", name: "田中 一郎", role: "TSK_ADMIN", locale: "ja", passwordHash },
      { organizationId: tsk.id, email: "tsk.staff@hashi.test", name: "Rina Staf TSK", role: "TSK_STAFF", locale: "id", passwordHash },
      { organizationId: lpk1.id, email: "lpk1.admin@hashi.test", name: "Admin LPK Bandung", role: "LPK_ADMIN", locale: "id", passwordHash },
      { organizationId: lpk1.id, email: "lpk1.sensei@hashi.test", name: "Sensei Bandung", role: "LPK_SENSEI", locale: "id", passwordHash },
      { organizationId: lpk2.id, email: "lpk2.admin@hashi.test", name: "Admin LPK Surabaya", role: "LPK_ADMIN", locale: "id", passwordHash },
      { organizationId: lpk3.id, email: "lpk3.admin@hashi.test", name: "Admin LPK Medan", role: "LPK_ADMIN", locale: "id", passwordHash },
    ]);

    const seeded = [
      ...candidateRows(lpk1.id, 0, 0),
      ...candidateRows(lpk2.id, 5, 1),
      ...candidateRows(lpk3.id, 11, 2),
    ];
    await tx.insert(candidates).values(seeded.map((c) => c.row));

    // Keputusan TSK demo hanya untuk LPK mitra (Bandung, Surabaya); LPK Medan tidak bermitra.
    const [tskAdmin] = await tx.select({ id: users.id }).from(users).where(eq(users.email, "tsk.admin@hashi.test"));
    const partnerIds = new Set([lpk1.id, lpk2.id]);
    const decided = seeded.filter((c) => c.decision && partnerIds.has(c.row.organizationId));
    await tx.insert(candidateSelections).values(
      decided.map((c) => ({
        candidateId: c.row.id,
        tskOrgId: tsk.id,
        decision: c.decision!,
        decidedBy: tskAdmin.id,
      })),
    );

    // Catatan TSK demo (面談メモ): satu hanya untuk TSK, satu dibagikan ke LPK.
    await tx.insert(candidateNotes).values([
      {
        candidateId: decided[1].row.id,
        tskOrgId: tsk.id,
        authorId: tskAdmin.id,
        body: "面談メモ：日本語の聞き取りは良好。介護分野の経験について追加で確認したい。",
        visibility: "TSK_ONLY",
      },
      {
        candidateId: decided[1].row.id,
        tskOrgId: tsk.id,
        authorId: tskAdmin.id,
        body: "面談メモ：健康診断書の再提出をお願いします。",
        visibility: "SHARED_WITH_LPK",
      },
    ]);

    // ---- Penilaian (langkah 4): riwayat bulanan LPK 3-6 bulan untuk sebagian kandidat, + sedikit penilaian TSK ----
    const userId = async (email: string) => (await tx.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id;
    const assessors: Record<number, string[]> = {
      0: [await userId("lpk1.admin@hashi.test"), await userId("lpk1.sensei@hashi.test")],
      1: [await userId("lpk2.admin@hashi.test")],
      2: [await userId("lpk3.admin@hashi.test")],
    };
    const today = todayInAppTz();
    const dayInPeriod = (period: string) => {
      const d = `${period.slice(0, 7)}-12`;
      return d > today ? today : d; // bulan berjalan: jangan di masa depan
    };
    const orgOrder = [lpk1.id, lpk2.id, lpk3.id];
    const lpkRows: Array<typeof candidateAssessments.$inferInsert> = [];
    seeded.forEach((c, n) => {
      const orgIndex = orgOrder.indexOf(c.row.organizationId);
      const i = n % PIPELINE.length;
      if (c.row.stage === "WITHDRAWN" || i === 0) return; // idx 0 tiap LPK sengaja belum pernah dinilai
      const history = 3 + (i % 4); // 3..6 bulan
      const skipThisMonth = i % 3 === 0; // sebagian belum dinilai bulan ini
      for (let j = 0; j < history; j++) {
        const monthsAgo = history - 1 - j + (skipThisMonth ? 1 : 0); // j = 0 paling lama
        const period = periodMonthsAgo(monthsAgo);
        const staff = assessors[orgIndex];
        lpkRows.push({
          candidateId: c.row.id,
          orgId: c.row.organizationId,
          kind: "LPK_MONTHLY",
          assessedOn: dayInPeriod(period),
          assessorId: staff[(i + j) % staff.length],
          durationMinutes: 30,
          scoreJapanese: Math.min(5, 2 + Math.floor(j / 2) + (i % 2)),
          scoreAttitude: Math.min(5, 3 + (j % 2)),
          scoreFitness: 3 + (i % 3 === 0 ? 1 : 0),
          scoreMotivation: Math.min(5, 3 + Math.floor(j / 3)),
          attendancePct: 80 + ((i * 7 + j * 3) % 21),
          testName: j % 3 === 2 ? "Tryout JLPT N4" : null,
          testScore: j % 3 === 2 ? 90 + j * 8 : null,
          note: `面談 bulan ke-${j + 1}: perkembangan baik.`,
          followUp: j === history - 1 ? "Perbanyak latihan kanji dan percakapan." : null,
        });
      }
    });
    await tx.insert(candidateAssessments).values(lpkRows);

    // Penilaian TSK (hanya untuk kandidat LPK Bandung yang dibagikan dan keputusannya sesuai)
    const bandung = seeded.slice(0, PIPELINE.length);
    const tskAdminId = await userId("tsk.admin@hashi.test");
    const tskStaffId = await userId("tsk.staff@hashi.test");
    await tx.insert(candidateAssessments).values([
      { candidateId: bandung[5].row.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: today, assessorId: tskStaffId, scoreJapanese: 4, scoreAttitude: 4, note: "Bertemu langsung di LPK: komunikasi baik.", visibility: "TSK_ONLY" },
      { candidateId: bandung[8].row.id, orgId: tsk.id, kind: "TSK_INTERVIEW", assessedOn: today, assessorId: tskAdminId, scoreJapanese: 4, scoreMotivation: 5, note: "面談 TSK: motivasi tinggi.", visibility: "TSK_ONLY" },
      { candidateId: bandung[9].row.id, orgId: tsk.id, kind: "TSK_INTERVIEW", assessedOn: today, assessorId: tskAdminId, scoreJapanese: 5, scoreAttitude: 4, note: "面談 TSK: layak diajukan ke client.", visibility: "SHARED_WITH_LPK" },
    ]);

    console.log(`✓ Seed selesai: 5 organisasi, 7 pengguna, 36 kandidat demo (3 tidak dibagikan ke TSK, 1 dibagikan tanpa tanggal formulir), ${decided.length} keputusan TSK, 2 catatan TSK, ${lpkRows.length} penilaian bulanan LPK + 3 penilaian TSK`);
    console.log(`  Password semua akun demo: ${PASSWORD}`);
  }, db);

  await pool.end();
}

main().catch((err) => {
  console.error("✗ Seed gagal:", err);
  process.exit(1);
});
