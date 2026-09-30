// Isi database dengan data DEMO (bukan data asli).
// Pemakaian: npm run db:seed          -> isi kalau database masih kosong
//            npm run db:seed -- --reset -> hapus semua data dulu, lalu isi ulang
//
// Berjalan sebagai role OWNER (MIGRATE_DATABASE_URL) dengan bypass RLS.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { createDb, withSystem } from "../src/db";
import {
  candidates,
  organizations,
  partnerships,
  users,
  type CandidateStage,
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

// Sebaran tahapan per LPK (12 kandidat): kebanyakan masih belajar/siap seleksi.
const STAGES: CandidateStage[] = [
  "STUDYING",
  "STUDYING",
  "STUDYING",
  "STUDYING",
  "READY",
  "READY",
  "READY",
  "SHORTLISTED",
  "PASSED_TSK_INTERVIEW",
  "SUBMITTED_TO_CLIENT",
  "PASSED_CLIENT_INTERVIEW",
  "WITHDRAWN",
];

function candidateRows(orgId: string, offset: number) {
  return STAGES.map((stage, i) => {
    const [first, firstKana, gender] = FIRST_NAMES[(i + offset) % FIRST_NAMES.length];
    const [last, lastKana] = LAST_NAMES[(i * 3 + offset) % LAST_NAMES.length];
    const year = 1998 + ((i + offset) % 8);
    const month = String(((i * 5 + offset) % 12) + 1).padStart(2, "0");
    return {
      organizationId: orgId,
      fullName: `${first} ${last}`,
      nameKatakana: `${firstKana}・${lastKana}`,
      gender,
      birthDate: `${year}-${month}-15`,
      field: FIELDS[(i + offset) % FIELDS.length],
      stage,
    };
  });
}

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set");
  const reset = process.argv.includes("--reset");

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

    await tx
      .insert(candidates)
      .values([...candidateRows(lpk1.id, 0), ...candidateRows(lpk2.id, 5), ...candidateRows(lpk3.id, 11)]);

    console.log("✓ Seed selesai: 5 organisasi, 7 pengguna, 36 kandidat demo");
    console.log(`  Password semua akun demo: ${PASSWORD}`);
  }, db);

  await pool.end();
}

main().catch((err) => {
  console.error("✗ Seed gagal:", err);
  process.exit(1);
});
