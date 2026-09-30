// Uji isolasi data (Row-Level Security) dengan role aplikasi `hashi_app`.
// Pemakaian: npm run test:rls   (butuh DATABASE_URL dan data seed demo)
//
// Setiap pemeriksaan memastikan satu aturan dari spesifikasi:
// LPK hanya melihat kandidatnya, TSK hanya melihat kandidat mitra yang sudah
// siap seleksi, dan tidak ada yang bisa menulis ke data organisasi lain.

import "dotenv/config";
import { and, eq, ne, sql } from "drizzle-orm";
import { createDb, withSystem, withTenant } from "../src/db";
import { platformOverview } from "../src/db/queries";
import { auditLogs, candidates, organizations, partnerships, users } from "../src/db/schema";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function expectError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { cause?: { message?: string }; message?: string };
    return e.cause?.message ?? e.message ?? String(err);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum di-set");
  const { db, pool } = createDb(url, 2);

  const who = await db.execute(sql`select current_user as u`);
  check("Terhubung sebagai hashi_app", who.rows[0]?.u === "hashi_app", String(who.rows[0]?.u));

  // Data acuan (mode sistem)
  const orgs = await withSystem((tx) => tx.select().from(organizations), db);
  const byName = (n: string) => {
    const o = orgs.find((x) => x.name === n);
    if (!o) throw new Error(`Organisasi "${n}" tidak ada. Jalankan npm run db:seed dulu.`);
    return o;
  };
  const tsk = byName("TSK Demo Tokyo");
  const lpk1 = byName("LPK Demo Bandung");
  const lpk2 = byName("LPK Demo Surabaya");
  const lpk3 = byName("LPK Non-Mitra Medan");

  const all = await withSystem((tx) => tx.select().from(candidates), db);
  const ownCount = (orgId: string) => all.filter((c) => c.organizationId === orgId).length;
  const tskExpected = all.filter(
    (c) => (c.organizationId === lpk1.id || c.organizationId === lpk2.id) && c.stage !== "STUDYING",
  ).length;

  // 1. Tanpa konteks: tidak melihat apa pun
  const noCtx = await db.transaction(async (tx) => ({
    c: (await tx.select().from(candidates)).length,
    u: (await tx.select().from(users)).length,
  }));
  check("Tanpa konteks organisasi: 0 kandidat, 0 pengguna", noCtx.c === 0 && noCtx.u === 0, `${noCtx.c}/${noCtx.u}`);

  // 2. LPK hanya melihat kandidat sendiri
  for (const lpk of [lpk1, lpk2, lpk3]) {
    const rows = await withTenant(lpk.id, (tx) => tx.select().from(candidates), db);
    const onlyOwn = rows.every((r) => r.organizationId === lpk.id);
    check(
      `${lpk.name}: hanya melihat ${ownCount(lpk.id)} kandidat sendiri`,
      onlyOwn && rows.length === ownCount(lpk.id),
      `terlihat ${rows.length}`,
    );
  }

  // 3. TSK melihat kandidat mitra yang sudah lewat STUDYING, dan tidak melihat LPK non-mitra
  const tskRows = await withTenant(tsk.id, (tx) => tx.select().from(candidates), db);
  check("TSK: jumlah kandidat mitra sesuai aturan", tskRows.length === tskExpected, `${tskRows.length}/${tskExpected}`);
  check("TSK: tidak ada kandidat berstatus STUDYING", tskRows.every((r) => r.stage !== "STUDYING"));
  check("TSK: tidak ada kandidat LPK non-mitra", tskRows.every((r) => r.organizationId !== lpk3.id));

  // 4. TSK tidak bisa mengubah data kandidat mitra
  const target = tskRows[0];
  const updated = await withTenant(
    tsk.id,
    (tx) =>
      tx.update(candidates).set({ fullName: "DIUBAH TSK" }).where(eq(candidates.id, target.id)).returning(),
    db,
  );
  check("TSK: tidak bisa mengubah kandidat mitra", updated.length === 0);

  // 5. LPK tidak bisa membuat kandidat atas nama organisasi lain
  const insertErr = await expectError(() =>
    withTenant(lpk1.id, (tx) => tx.insert(candidates).values({ organizationId: lpk2.id, fullName: "Titipan" }), db),
  );
  check("LPK: tidak bisa menulis kandidat ke LPK lain", insertErr !== null && /row-level security/i.test(insertErr));

  // 6. LPK tidak bisa memindahkan kandidatnya ke LPK lain
  const own = all.find((c) => c.organizationId === lpk1.id)!;
  const moveErr = await expectError(() =>
    withTenant(lpk1.id, (tx) => tx.update(candidates).set({ organizationId: lpk2.id }).where(eq(candidates.id, own.id)), db),
  );
  check("LPK: tidak bisa memindahkan kandidat ke LPK lain", moveErr !== null && /row-level security/i.test(moveErr));

  // 7. Pengguna organisasi lain tidak terlihat
  const tskUsers = await withTenant(tsk.id, (tx) => tx.select().from(users), db);
  check("TSK: hanya melihat pengguna TSK sendiri", tskUsers.length > 0 && tskUsers.every((u) => u.organizationId === tsk.id));

  // 8. Organisasi: sendiri + mitra saja
  const lpk3Orgs = await withTenant(lpk3.id, (tx) => tx.select().from(organizations), db);
  check("LPK non-mitra: hanya melihat organisasinya sendiri", lpk3Orgs.length === 1 && lpk3Orgs[0].id === lpk3.id);
  const tskOrgs = await withTenant(tsk.id, (tx) => tx.select().from(organizations).where(ne(organizations.id, tsk.id)), db);
  check(
    "TSK: melihat 2 LPK mitra, bukan LPK non-mitra",
    tskOrgs.length === 2 && tskOrgs.every((o) => o.id !== lpk3.id),
    tskOrgs.map((o) => o.name).join(", "),
  );

  // 9. Kemitraan hanya bisa diubah oleh sistem
  const partnerErr = await expectError(() =>
    withTenant(lpk3.id, (tx) => tx.insert(partnerships).values({ lpkId: lpk3.id, tskId: tsk.id }), db),
  );
  check("LPK: tidak bisa membuat kemitraan sendiri", partnerErr !== null);

  // 10. Audit log append-only
  const auditDelErr = await expectError(() =>
    withTenant(lpk1.id, (tx) => tx.delete(auditLogs).where(and(eq(auditLogs.organizationId, lpk1.id))), db),
  );
  check("Audit log: aplikasi tidak bisa menghapus", auditDelErr !== null && /permission denied/i.test(auditDelErr));

  // 11. Ringkasan super admin: angka per organisasi harus cocok dengan data sebenarnya
  const allUsers = await withSystem((tx) => tx.select().from(users), db);
  const overview = await withSystem((tx) => platformOverview(tx), db);
  const mismatches = overview.filter(
    (o) =>
      o.users !== allUsers.filter((u) => u.organizationId === o.id).length ||
      o.candidates !== ownCount(o.id),
  );
  check(
    "Super admin: jumlah pengguna & kandidat per organisasi benar",
    overview.length === orgs.length && mismatches.length === 0 && overview.some((o) => o.candidates > 0),
    overview.map((o) => `${o.name}: ${o.users}/${o.candidates}`).join(", "),
  );

  // --- Aturan pengguna & kemitraan (dijalankan lalu di-rollback, tidak meninggalkan data) ---
  class Rollback extends Error {}
  async function inRollback(fn: () => Promise<unknown>): Promise<string | null> {
    try {
      await fn();
      return null;
    } catch (err) {
      if (err instanceof Rollback) return null;
      const e = err as { cause?: { message?: string }; message?: string };
      return e.cause?.message ?? e.message ?? String(err);
    }
  }
  const tempUser = (orgId: string, role: (typeof users.$inferInsert)["role"]) => ({
    organizationId: orgId,
    email: `rls-test-${Date.now()}@hashi.test`,
    name: "Uji",
    role,
    passwordHash: "x",
  });

  // 12. Admin LPK bisa menambah sensei di organisasinya sendiri
  const addSenseiErr = await inRollback(() =>
    withTenant(lpk1.id, async (tx) => {
      await tx.insert(users).values(tempUser(lpk1.id, "LPK_SENSEI"));
      throw new Rollback();
    }, db),
  );
  check("LPK: bisa menambah sensei di organisasi sendiri", addSenseiErr === null, addSenseiErr ?? "");

  // 13-14. Peran harus sesuai jenis organisasi (mencegah eskalasi hak akses)
  const escalateErr = await inRollback(() =>
    withTenant(lpk1.id, (tx) => tx.insert(users).values(tempUser(lpk1.id, "SUPER_ADMIN")), db),
  );
  check("LPK: tidak bisa membuat SUPER_ADMIN", escalateErr !== null && /tidak diizinkan/.test(escalateErr));
  const promoteErr = await inRollback(() =>
    withTenant(lpk1.id, (tx) => tx.update(users).set({ role: "TSK_STAFF" }).where(eq(users.organizationId, lpk1.id)), db),
  );
  check("LPK: tidak bisa memberi peran TSK ke pengguna LPK", promoteErr !== null && /tidak diizinkan/.test(promoteErr));

  // 15. Pengguna tidak bisa dipindah ke organisasi lain
  const moveUserErr = await inRollback(() =>
    withTenant(lpk1.id, (tx) => tx.update(users).set({ organizationId: lpk2.id }).where(eq(users.organizationId, lpk1.id)), db),
  );
  check("LPK: tidak bisa memindahkan pengguna ke organisasi lain", moveUserErr !== null);

  // 16. Organisasi hanya bisa diubah oleh sistem (super admin)
  const renamed = await withTenant(
    lpk1.id,
    (tx) => tx.update(organizations).set({ name: "Diubah LPK" }).where(eq(organizations.id, lpk1.id)).returning(),
    db,
  );
  check("LPK: tidak bisa mengubah data organisasinya sendiri", renamed.length === 0);

  // 17. Kemitraan harus LPK dengan TSK; jenis organisasi tidak bisa diubah
  const badPairErr = await inRollback(() =>
    withSystem((tx) => tx.insert(partnerships).values({ lpkId: lpk1.id, tskId: lpk2.id }), db),
  );
  check("Sistem: kemitraan LPK dengan LPK ditolak", badPairErr !== null && /LPK dan TSK/.test(badPairErr));
  const typeErr = await inRollback(() =>
    withSystem((tx) => tx.update(organizations).set({ type: "TSK" }).where(eq(organizations.id, lpk1.id)), db),
  );
  check("Sistem: jenis organisasi tidak bisa diubah", typeErr !== null && /tidak bisa diubah/.test(typeErr));

  // 18. Email wajib huruf kecil
  const upperErr = await inRollback(() =>
    withTenant(lpk1.id, (tx) => tx.insert(users).values({ ...tempUser(lpk1.id, "LPK_SENSEI"), email: "Besar@Hashi.test" }), db),
  );
  check("Email dengan huruf besar ditolak database", upperErr !== null);

  await pool.end();
  console.log(failures === 0 ? "\nSemua pemeriksaan RLS lulus." : `\n${failures} pemeriksaan GAGAL.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exit(1);
});
