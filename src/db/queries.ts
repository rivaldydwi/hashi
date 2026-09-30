// Kueri yang dipakai lebih dari satu tempat (halaman + script pengujian).

import { asc, count } from "drizzle-orm";
import type { Tx } from "./index";
import { candidates, organizations, users } from "./schema";

/**
 * Ringkasan semua organisasi untuk super admin: jumlah pengguna dan kandidat.
 * Harus dijalankan lewat withSystem(). Hanya angka, tanpa data pribadi.
 *
 * Catatan: sengaja memakai GROUP BY terpisah, bukan subquery di dalam SELECT.
 * Drizzle menulis kolom tabel utama tanpa nama tabel ("id"), sehingga di dalam
 * subquery Postgres membacanya sebagai kolom tabel dalam (users.id) -> hasil 0.
 */
export async function platformOverview(tx: Tx) {
  const orgs = await tx
    .select({ id: organizations.id, name: organizations.name, type: organizations.type })
    .from(organizations)
    .orderBy(asc(organizations.type), asc(organizations.name));
  const userCounts = await tx
    .select({ orgId: users.organizationId, total: count() })
    .from(users)
    .groupBy(users.organizationId);
  const candidateCounts = await tx
    .select({ orgId: candidates.organizationId, total: count() })
    .from(candidates)
    .groupBy(candidates.organizationId);

  const usersByOrg = new Map(userCounts.map((r) => [r.orgId, r.total]));
  const candidatesByOrg = new Map(candidateCounts.map((r) => [r.orgId, r.total]));

  return orgs.map((o) => ({
    ...o,
    users: usersByOrg.get(o.id) ?? 0,
    candidates: candidatesByOrg.get(o.id) ?? 0,
  }));
}
