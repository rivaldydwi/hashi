// Jalankan semua migration di folder ./drizzle sebagai role OWNER.
// Pemakaian: npm run db:migrate  (butuh MIGRATE_DATABASE_URL)

import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/db";

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL belum di-set");

  const { db, pool } = createDb(url, 1);
  console.log("▶ Menjalankan migration...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ Migration selesai");
  await pool.end();
}

main().catch((err) => {
  console.error("✗ Migration gagal:", err);
  process.exit(1);
});
