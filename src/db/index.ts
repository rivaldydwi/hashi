// Akses database Hashi.
//
// ATURAN: data tenant SELALU dibaca/ditulis lewat withTenant() atau withSystem().
// Keduanya membuka transaksi dan mengisi variabel sesi yang dipakai policy RLS
// (app.org_id, app.role, app.user_id, app.bypass_rls; lihat drizzle/0001_rls_policies.sql dan
// drizzle/0005_candidate_profile_rls.sql). Query di luar keduanya tidak akan
// melihat data apa pun, karena RLS menolak secara default.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Role } from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Handle = { pool: Pool; db: Db };

/** Buat koneksi baru. Dipakai script (migrate, seed, verify) dengan URL tertentu. */
export function createDb(connectionString: string, max = 10): Handle {
  const pool = new Pool({ connectionString, max });
  return { pool, db: drizzle(pool, { schema }) };
}

// Satu pool per proses. Disimpan di globalThis supaya hot-reload saat dev
// tidak membuat pool baru terus-menerus. Dibuat saat pertama dipakai
// (bukan saat import) supaya `next build` tidak butuh DATABASE_URL.
const globalForDb = globalThis as unknown as { hashiDb?: Handle };

function appDb(): Db {
  if (!globalForDb.hashiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL belum di-set");
    globalForDb.hashiDb = createDb(url);
  }
  return globalForDb.hashiDb.db;
}

async function runScoped<T>(
  db: Db,
  orgId: string,
  role: Role | null,
  userId: string | null,
  bypass: boolean,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // `true` = berlaku lokal untuk transaksi ini saja, otomatis hilang setelah commit.
    await tx.execute(
      sql`select set_config('app.org_id', ${orgId}, true), set_config('app.role', ${role ?? ""}, true), set_config('app.user_id', ${userId ?? ""}, true), set_config('app.bypass_rls', ${bypass ? "on" : "off"}, true)`,
    );
    return fn(tx);
  });
}

/** Identitas yang dipakai policy RLS: app.org_id, app.role, app.user_id. */
export type TenantScope = {
  orgId: string;
  /**
   * Wajib diisi (boleh null) supaya pemanggil tidak lupa. Beberapa tabel (data sensitif kandidat,
   * dokumen) hanya terbuka untuk peran tertentu; `null` = "peran tidak diketahui" -> ditolak.
   * `null` hanya pantas untuk tabel yang tidak bergantung peran (mis. baris `users` saat login).
   */
  role: Role | null;
  /** User yang login. Dipakai policy yang membedakan penulis (mis. mengubah catatan TSK). Kosong = ditolak. */
  userId?: string | null;
};

/** Jalankan query sebagai organisasi + peran + user tertentu. RLS membatasi data yang terlihat. */
export function withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>, db: Db = appDb()) {
  if (!scope.orgId) throw new Error("withTenant: orgId kosong");
  return runScoped(db, scope.orgId, scope.role, scope.userId ?? null, false, fn);
}

/**
 * Jalankan query tanpa batas organisasi. HANYA untuk operasi sistem:
 * login, pekerjaan super admin, worker terjadwal, seed.
 */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>, db: Db = appDb()) {
  return runScoped(db, "", null, null, true, fn);
}

/** Cek koneksi database (untuk /api/health). */
export async function pingDb(): Promise<void> {
  await appDb().execute(sql`select 1`);
}

export { schema };
