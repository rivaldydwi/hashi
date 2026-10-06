// Mengisi kolom baru "Informasi untuk lembar" (langkah 6) pada data klien/job order DUMMY yang sudah ada, TANPA reseed. Aman untuk produksi demo dan instance demo.
//
//   npm run seed:client-sheet
//
// Jaminan: hanya organisasi dummy (menolak jalan bila ada organisasi di luar daftar dummy), hanya mengisi kolom yang masih NULL, idempoten (jalan kedua = 0 perubahan),
// tidak menghapus apa pun, tidak mengubah baris lain. Satu perusahaan dan satu job order sengaja dibiarkan tidak lengkap.
import "dotenv/config";
import { createDb, withSystem } from "../src/db";
import { seedClientSheet } from "../src/db/demo-client-sheet";
import { DUMMY_ORG_NAME } from "../src/db/demo-records";
import { organizations } from "../src/db/schema";

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set");
  const { db, pool } = createDb(url, 1);
  try {
    const res = await withSystem(async (tx) => {
      const orgs = await tx.select({ name: organizations.name }).from(organizations);
      const foreign = orgs.filter((o) => !DUMMY_ORG_NAME.test(o.name));
      if (orgs.length === 0 || foreign.length > 0) {
        throw new Error(`DITOLAK: ada organisasi di luar daftar dummy (${foreign.map((o) => o.name).join(", ") || "database kosong"}). seed:client-sheet hanya untuk data dummy.`);
      }
      return seedClientSheet(tx);
    }, db);
    for (const n of res.skipped) console.log(`ℹ dilewati: ${n}`);
    console.log(`✓ seed:client-sheet selesai: ${res.companies} perusahaan, ${res.sites} lokasi, ${res.jobOrders} job order diisi (kolom yang sudah terisi tidak disentuh)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
