// Menambahkan data PILOT (langkah 8, T-014): +200 kandidat dummy lengkap beserta pekerja aktif, kartu 在留カード di semua tahap, catatan, dan wawancara, di atas seed dasar.
//
//   npm run seed:pilot
//
// Jaminan: HANYA menambah (tidak menghapus/menimpa apa pun), deterministik, idempoten (dijalankan dua kali tidak menggandakan). DITOLAK di database selain _dev/_test/_demo (db-guard) dan bila ada
// organisasi di luar daftar dummy. Berkas dokumen dummy kecil ditulis ke STORAGE_DIR. Hanya mengimpor dari src/db (aturan scripts/).
import "dotenv/config";
import path from "node:path";
import { createDb, withSystem } from "../src/db";
import { assertTestDatabase } from "./db-guard";
import { demoDocumentPath, dummyPdf, dummyPng, storageRootFor, writeDemoFile } from "../src/db/demo-files";
import { DUMMY_ORG_NAME } from "../src/db/demo-records";
import { seedPilot } from "../src/db/demo-pilot";
import { organizations } from "../src/db/schema";
import { todayInTskTz } from "../src/db/time";

async function main() {
  assertTestDatabase("seed:pilot");
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set");
  const { db, pool } = createDb(url, 1);
  let result: Awaited<ReturnType<typeof seedPilot>> | null = null;
  try {
    await withSystem(async (tx) => {
      const orgs = await tx.select({ name: organizations.name }).from(organizations);
      const foreign = orgs.filter((o) => !DUMMY_ORG_NAME.test(o.name));
      if (orgs.length === 0 || foreign.length > 0) {
        throw new Error(`DITOLAK: ada organisasi di luar daftar dummy (${foreign.map((o) => o.name).join(", ") || "database kosong"}). seed:pilot hanya untuk data dummy.`);
      }
      result = await seedPilot(tx, { today: todayInTskTz() });
    }, db);
    const root = storageRootFor();
    const pdf = dummyPdf("Pilot");
    const png = dummyPng();
    for (const f of result!.files) await writeDemoFile(demoDocumentPath(root, f.orgId, f.candidateId, f.documentId, f.ext), f.ext === "png" ? png : pdf);
    for (const n of result!.notes) console.log(`ℹ ${n}`);
    console.log(`✓ seed:pilot selesai: ${JSON.stringify(result!.summary)}; ${result!.files.length} berkas dokumen dummy ditulis ke ${path.resolve(root)}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
