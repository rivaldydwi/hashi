// Menambahkan data DEMO fitur Catatan kegiatan (langkah 7A) di atas data yang SUDAH ada, TANPA reseed. Aman untuk produksi demo dan instance demo.
//
//   npm run seed:records            -> tambah (menolak bila tabel fitur sudah berisi)
//   npm run seed:records -- --force -> tetap jalan; baris ber-id deterministik yang sudah ada dilewati (tidak ada yang dihapus atau ditimpa)
//
// Jaminan: hanya organisasi dummy (nama dikenal / E2E), tidak menghapus apa pun, menolak jalan bila ada organisasi di luar daftar dummy.
// Yang disentuh selain tabel fitur (dilaporkan di keluaran): 1 pengguna dummy TSK_STAFF bila staf TSK < 3, dan 1 keputusan DEPARTED (+ penempatan
// otomatis) bila pekerja aktif < 3. Berkas lampiran ditulis ke STORAGE_DIR/activity.
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createDb, withSystem } from "../src/db";
import { DUMMY_ORG_NAME, recordsTablesNotEmpty, seedRecords } from "../src/db/demo-records";
import { demoAttachmentPath, dummyPng, storageRootFor, writeDemoFile } from "../src/db/demo-files";
import { organizations } from "../src/db/schema";
import { todayInTskTz } from "../src/db/time";

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set");
  const force = process.argv.includes("--force");
  const { db, pool } = createDb(url, 1);
  const password = process.env.SEED_PASSWORD || "hashi-demo-2026";
  const passwordHash = await bcrypt.hash(password, 12);
  let result: Awaited<ReturnType<typeof seedRecords>> | null = null;
  try {
    await withSystem(async (tx) => {
      const orgs = await tx.select({ name: organizations.name }).from(organizations);
      const foreign = orgs.filter((o) => !DUMMY_ORG_NAME.test(o.name));
      if (orgs.length === 0 || foreign.length > 0) {
        throw new Error(`DITOLAK: ada organisasi di luar daftar dummy (${foreign.map((o) => o.name).join(", ") || "database kosong"}). seed:records hanya untuk data dummy.`);
      }
      if (!force && (await recordsTablesNotEmpty(tx))) throw new Error("DITOLAK: tabel Catatan kegiatan sudah berisi. Pakai --force bila memang ingin menambahkan baris yang belum ada.");
      result = await seedRecords(tx, { today: todayInTskTz(), passwordHash, force }, dummyPng);
    }, db);
    const root = storageRootFor();
    await mkdir(path.join(root, "activity"), { recursive: true });
    for (const f of result!.files) await writeDemoFile(demoAttachmentPath(root, f.orgId, f.id, f.ext), f.data);
    for (const n of result!.notes) console.log(`ℹ ${n}`);
    console.log(`✓ seed:records selesai: ${JSON.stringify(result!.summary)}; ${result!.files.length} berkas lampiran ditulis ke ${path.join(root, "activity")}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
