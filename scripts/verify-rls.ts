// Uji isolasi data (Row-Level Security) dengan role aplikasi `hashi_app`.
// Pemakaian: npm run test:rls   (butuh DATABASE_URL dan data seed demo)
//
// Setiap pemeriksaan memastikan satu aturan dari spesifikasi:
// LPK hanya melihat kandidatnya; TSK melihat kandidat LPK mitra di semua tahap TAPI hanya
// yang sudah punya persetujuan berbagi data; tidak ada yang bisa menulis ke data organisasi
// lain; sensei tidak bisa membaca data sensitif/dokumen; TSK boleh mengubah tahap (stage)
// di tahap apa pun, tetapi mengedit isi data hanya pada PASSED_CLIENT_INTERVIEW,
// DOCUMENT_PROCESS, DEPARTED.
//
// Pemeriksaan yang menulis data dijalankan di dalam transaksi yang selalu di-rollback.

import "dotenv/config";
import { and, eq, ne, sql } from "drizzle-orm";
import { createDb, withSystem, withTenant, type Tx } from "../src/db";
import { platformOverview } from "../src/db/queries";
import {
  auditLogs,
  candidateCertificates,
  candidateDocuments,
  candidateEducations,
  candidateFamilyMembers,
  candidatePrivate,
  candidates,
  candidateStage,
  organizations,
  partnerships,
  users,
} from "../src/db/schema";

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

class Rollback extends Error {}

async function errorMessage(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof Rollback) return null;
    const e = err as { cause?: { message?: string }; message?: string };
    return e.cause?.message ?? e.message ?? String(err);
  }
}

/** Ganti identitas sesi di tengah transaksi (sama seperti yang dilakukan withTenant di awal). */
async function actAs(tx: Tx, orgId: string, role: string | null) {
  await tx.execute(
    sql`select set_config('app.org_id', ${orgId}, true), set_config('app.role', ${role ?? ""}, true), set_config('app.bypass_rls', 'off', true)`,
  );
}
async function actAsSystem(tx: Tx) {
  await tx.execute(
    sql`select set_config('app.org_id', '', true), set_config('app.role', '', true), set_config('app.bypass_rls', 'on', true)`,
  );
}

/** Coba satu perintah di dalam savepoint, supaya error tidak menggagalkan transaksi induk. */
async function attempt(tx: Tx, fn: (t: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp as unknown as Tx);
    });
    return null;
  } catch (err) {
    const e = err as { cause?: { message?: string }; message?: string };
    return e.cause?.message ?? e.message ?? String(err);
  }
}

/** Jalankan perintah yang mengembalikan baris di dalam savepoint: jumlah baris, atau error. */
async function rowsOf(tx: Tx, fn: (t: Tx) => Promise<unknown[]>): Promise<{ n: number; err: string | null }> {
  try {
    let n = 0;
    await tx.transaction(async (sp) => {
      n = (await fn(sp as unknown as Tx)).length;
    });
    return { n, err: null };
  } catch (err) {
    const e = err as { cause?: { message?: string }; message?: string };
    return { n: 0, err: e.cause?.message ?? e.message ?? String(err) };
  }
}

/** Jalankan blok di dalam savepoint yang SELALU di-rollback (identitas & data kembali seperti semula). */
async function scratch(tx: Tx, fn: (t: Tx) => Promise<void>) {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp as unknown as Tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

/** RLS dilewati (bypass) tetapi app.role diisi: menguji trigger database saja, tanpa policy. */
async function actAsTriggerOnly(tx: Tx, role: string) {
  await tx.execute(
    sql`select set_config('app.org_id', '', true), set_config('app.role', ${role}, true), set_config('app.bypass_rls', 'on', true)`,
  );
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
  // TSK melihat SEMUA tahap dari LPK mitra, tetapi hanya yang punya tanggal persetujuan berbagi data.
  const isPartner = (c: { organizationId: string }) => c.organizationId === lpk1.id || c.organizationId === lpk2.id;
  const tskVisible = all.filter((c) => isPartner(c) && c.dataConsentDate !== null);
  const tskExpected = tskVisible.length;
  const noConsent = all.filter((c) => c.dataConsentDate === null);

  // 1. Tanpa konteks: tidak melihat apa pun
  const noCtx = await db.transaction(async (tx) => ({
    c: (await tx.select().from(candidates)).length,
    u: (await tx.select().from(users)).length,
  }));
  check("Tanpa konteks organisasi: 0 kandidat, 0 pengguna", noCtx.c === 0 && noCtx.u === 0, `${noCtx.c}/${noCtx.u}`);

  // 2. LPK hanya melihat kandidat sendiri
  for (const lpk of [lpk1, lpk2, lpk3]) {
    const rows = await withTenant(lpk.id, "LPK_ADMIN", (tx) => tx.select().from(candidates), db);
    const onlyOwn = rows.every((r) => r.organizationId === lpk.id);
    check(
      `${lpk.name}: hanya melihat ${ownCount(lpk.id)} kandidat sendiri`,
      onlyOwn && rows.length === ownCount(lpk.id),
      `terlihat ${rows.length}`,
    );
  }

  // 3. TSK melihat kandidat LPK mitra di semua tahap (asal ada persetujuan), bukan LPK non-mitra
  const tskRows = await withTenant(tsk.id, "TSK_ADMIN", (tx) => tx.select().from(candidates), db);
  check("TSK: jumlah kandidat mitra sesuai aturan", tskRows.length === tskExpected, `${tskRows.length}/${tskExpected}`);
  const studyingSeen = tskRows.filter((r) => r.stage === "STUDYING").length;
  const studyingExpected = tskVisible.filter((c) => c.stage === "STUDYING").length;
  check(
    "TSK: melihat kandidat STUDYING yang punya tanggal persetujuan",
    studyingSeen > 0 && studyingSeen === studyingExpected,
    `${studyingSeen}/${studyingExpected}`,
  );
  check(
    "TSK: melihat kandidat WITHDRAWN yang punya tanggal persetujuan",
    tskRows.filter((r) => r.stage === "WITHDRAWN").length === tskVisible.filter((c) => c.stage === "WITHDRAWN").length &&
      tskRows.some((r) => r.stage === "WITHDRAWN"),
  );
  check(
    "TSK: tidak melihat kandidat tanpa tanggal persetujuan",
    noConsent.length === 1 &&
      isPartner(noConsent[0]) &&
      !tskRows.some((r) => r.id === noConsent[0].id) &&
      tskRows.every((r) => r.dataConsentDate !== null),
    `kandidat tanpa persetujuan: ${noConsent.map((c) => c.fullName).join(", ")} (${noConsent[0]?.stage})`,
  );
  check("TSK: tidak ada kandidat LPK non-mitra", tskRows.every((r) => r.organizationId !== lpk3.id));

  // 4. TSK tidak bisa mengubah isi data kandidat yang belum sampai PASSED_CLIENT_INTERVIEW
  //    (pemeriksaan lengkap per tahap ada di bagian "Profil kandidat" di bawah)
  const target = tskRows.find((r) => r.stage === "READY")!;
  const nameErr = await errorMessage(() =>
    withTenant(tsk.id, "TSK_ADMIN", (tx) => tx.update(candidates).set({ fullName: "DIUBAH TSK" }).where(eq(candidates.id, target.id)), db),
  );
  check("TSK: tidak bisa mengubah nama kandidat READY milik mitra", nameErr !== null && /hanya boleh mengubah tahap/.test(nameErr), nameErr ?? "");

  // 5. LPK tidak bisa membuat kandidat atas nama organisasi lain
  const insertErr = await expectError(() =>
    withTenant(lpk1.id, "LPK_ADMIN", (tx) => tx.insert(candidates).values({ organizationId: lpk2.id, fullName: "Titipan" }), db),
  );
  check("LPK: tidak bisa menulis kandidat ke LPK lain", insertErr !== null && /row-level security/i.test(insertErr));

  // 6. LPK tidak bisa memindahkan kandidatnya ke LPK lain
  const own = all.find((c) => c.organizationId === lpk1.id)!;
  const moveErr = await expectError(() =>
    withTenant(lpk1.id, "LPK_ADMIN", (tx) => tx.update(candidates).set({ organizationId: lpk2.id }).where(eq(candidates.id, own.id)), db),
  );
  check(
    "LPK: tidak bisa memindahkan kandidat ke LPK lain",
    moveErr !== null && /row-level security|tidak bisa dipindahkan/i.test(moveErr),
    moveErr ?? "",
  );

  // 7. Pengguna organisasi lain tidak terlihat
  const tskUsers = await withTenant(tsk.id, "TSK_ADMIN", (tx) => tx.select().from(users), db);
  check("TSK: hanya melihat pengguna TSK sendiri", tskUsers.length > 0 && tskUsers.every((u) => u.organizationId === tsk.id));

  // 8. Organisasi: sendiri + mitra saja
  const lpk3Orgs = await withTenant(lpk3.id, "LPK_ADMIN", (tx) => tx.select().from(organizations), db);
  check("LPK non-mitra: hanya melihat organisasinya sendiri", lpk3Orgs.length === 1 && lpk3Orgs[0].id === lpk3.id);
  const tskOrgs = await withTenant(tsk.id, "TSK_ADMIN", (tx) => tx.select().from(organizations).where(ne(organizations.id, tsk.id)), db);
  check(
    "TSK: melihat 2 LPK mitra, bukan LPK non-mitra",
    tskOrgs.length === 2 && tskOrgs.every((o) => o.id !== lpk3.id),
    tskOrgs.map((o) => o.name).join(", "),
  );

  // 9. Kemitraan hanya bisa diubah oleh sistem
  const partnerErr = await expectError(() =>
    withTenant(lpk3.id, "LPK_ADMIN", (tx) => tx.insert(partnerships).values({ lpkId: lpk3.id, tskId: tsk.id }), db),
  );
  check("LPK: tidak bisa membuat kemitraan sendiri", partnerErr !== null);

  // 10. Audit log append-only
  const auditDelErr = await expectError(() =>
    withTenant(lpk1.id, "LPK_ADMIN", (tx) => tx.delete(auditLogs).where(and(eq(auditLogs.organizationId, lpk1.id))), db),
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
  const inRollback = errorMessage;
  const tempUser = (orgId: string, role: (typeof users.$inferInsert)["role"]) => ({
    organizationId: orgId,
    email: `rls-test-${Date.now()}@hashi.test`,
    name: "Uji",
    role,
    passwordHash: "x",
  });

  // 12. Admin LPK bisa menambah sensei di organisasinya sendiri
  const addSenseiErr = await inRollback(() =>
    withTenant(lpk1.id, "LPK_ADMIN", async (tx) => {
      await tx.insert(users).values(tempUser(lpk1.id, "LPK_SENSEI"));
      throw new Rollback();
    }, db),
  );
  check("LPK: bisa menambah sensei di organisasi sendiri", addSenseiErr === null, addSenseiErr ?? "");

  // 13-14. Peran harus sesuai jenis organisasi (mencegah eskalasi hak akses)
  const escalateErr = await inRollback(() =>
    withTenant(lpk1.id, "LPK_ADMIN", (tx) => tx.insert(users).values(tempUser(lpk1.id, "SUPER_ADMIN")), db),
  );
  check("LPK: tidak bisa membuat SUPER_ADMIN", escalateErr !== null && /tidak diizinkan/.test(escalateErr));
  const promoteErr = await inRollback(() =>
    withTenant(lpk1.id, "LPK_ADMIN", (tx) => tx.update(users).set({ role: "TSK_STAFF" }).where(eq(users.organizationId, lpk1.id)), db),
  );
  check("LPK: tidak bisa memberi peran TSK ke pengguna LPK", promoteErr !== null && /tidak diizinkan/.test(promoteErr));

  // 15. Pengguna tidak bisa dipindah ke organisasi lain
  const moveUserErr = await inRollback(() =>
    withTenant(lpk1.id, "LPK_ADMIN", (tx) => tx.update(users).set({ organizationId: lpk2.id }).where(eq(users.organizationId, lpk1.id)), db),
  );
  check("LPK: tidak bisa memindahkan pengguna ke organisasi lain", moveUserErr !== null);

  // 16. Organisasi hanya bisa diubah oleh sistem (super admin)
  const renamed = await withTenant(lpk1.id, "LPK_ADMIN",
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
    withTenant(lpk1.id, "LPK_ADMIN", (tx) => tx.insert(users).values({ ...tempUser(lpk1.id, "LPK_SENSEI"), email: "Besar@Hashi.test" }), db),
  );
  check("Email dengan huruf besar ditolak database", upperErr !== null);

  // ==========================================================================
  // Profil kandidat: data sensitif, dokumen, persetujuan data, dan hak edit per peran
  // ==========================================================================
  const TSK_EDITABLE = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"]; // sengaja ditulis eksplisit
  const consented = (c: (typeof all)[number]) => c.dataConsentDate !== null;
  const ready1 = all.find((c) => c.organizationId === lpk1.id && c.stage === "READY" && consented(c))!;
  const studying1 = all.find((c) => c.organizationId === lpk1.id && c.stage === "STUDYING" && consented(c))!;
  const outsider = all.find((c) => c.organizationId === lpk3.id && c.stage === "READY" && consented(c))!;
  const hidden = noConsent[0]; // LPK Bandung, READY, tanpa persetujuan
  const tskAdminUser = allUsers.find((u) => u.role === "TSK_ADMIN")!;

  const NIK = "3273010101990001";
  const nikOf = (c: { id: string }) => `${NIK}-${c.id.slice(0, 8)}`;
  const sampleDoc = (candidateId: string) => ({
    candidateId,
    type: "KTP" as const,
    originalFilename: "ktp.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1000,
  });

  async function sandbox(fn: (tx: Tx) => Promise<void>) {
    await errorMessage(() =>
      withSystem(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }, db),
    );
  }

  // --- A. Siapa boleh MEMBACA apa ---
  type Seen = { priv: string[]; docs: number; family: number; edu: number; cert: number; cands: number };
  const seen: Record<string, Seen> = {};
  await sandbox(async (tx) => {
    for (const c of [ready1, studying1, outsider, hidden]) {
      await tx.insert(candidatePrivate).values({ candidateId: c.id, nationalId: nikOf(c), phone: "0812" });
    }
    await tx.insert(candidateDocuments).values([sampleDoc(ready1.id), sampleDoc(hidden.id)]);
    await tx.insert(candidateFamilyMembers).values({ candidateId: ready1.id, relation: "FATHER", name: "Ayah Uji" });
    await tx.insert(candidateEducations).values({ candidateId: ready1.id, schoolName: "SMK Uji" });
    await tx.insert(candidateCertificates).values({ candidateId: ready1.id, type: "JLPT", levelOrField: "N4" });

    const view = async (label: string, orgId: string, role: string | null) => {
      await actAs(tx, orgId, role);
      seen[label] = {
        priv: (await tx.select().from(candidatePrivate)).map((r) => r.nationalId ?? ""),
        docs: (await tx.select().from(candidateDocuments)).length,
        family: (await tx.select().from(candidateFamilyMembers)).length,
        edu: (await tx.select().from(candidateEducations)).length,
        cert: (await tx.select().from(candidateCertificates)).length,
        cands: (await tx.select().from(candidates)).length,
      };
    };
    await view("lpk1-admin", lpk1.id, "LPK_ADMIN");
    await view("lpk1-sensei", lpk1.id, "LPK_SENSEI");
    await view("lpk1-norole", lpk1.id, null);
    await view("lpk2-admin", lpk2.id, "LPK_ADMIN");
    await view("tsk-admin", tsk.id, "TSK_ADMIN");
    await view("tsk-staff", tsk.id, "TSK_STAFF");
  });
  const sorted = (a: string[]) => [...a].sort().join();

  check(
    "Admin LPK: membaca data sensitif + dokumen + keluarga kandidatnya (juga yang belum ada persetujuan)",
    sorted(seen["lpk1-admin"].priv) === sorted([ready1, studying1, hidden].map(nikOf)) && // bukan milik lpk3
      seen["lpk1-admin"].docs === 2 &&
      seen["lpk1-admin"].family === 1,
    `NIK: ${seen["lpk1-admin"].priv.length} baris, dokumen ${seen["lpk1-admin"].docs}`,
  );
  check(
    "Sensei: tidak bisa membaca candidate_private, dokumen, maupun data keluarga",
    seen["lpk1-sensei"].priv.length === 0 && seen["lpk1-sensei"].docs === 0 && seen["lpk1-sensei"].family === 0,
    JSON.stringify(seen["lpk1-sensei"]),
  );
  check(
    "Sensei: tetap melihat daftar kandidat, pendidikan, dan sertifikat",
    seen["lpk1-sensei"].cands === ownCount(lpk1.id) && seen["lpk1-sensei"].edu === 1 && seen["lpk1-sensei"].cert === 1,
    `kandidat ${seen["lpk1-sensei"].cands}/${ownCount(lpk1.id)}, pendidikan ${seen["lpk1-sensei"].edu}, sertifikat ${seen["lpk1-sensei"].cert}`,
  );
  check(
    "Peran tidak dikenal (null): ditolak membaca data sensitif dan dokumen",
    seen["lpk1-norole"].priv.length === 0 && seen["lpk1-norole"].docs === 0 && seen["lpk1-norole"].family === 0,
  );
  check(
    "LPK lain: tidak bisa membaca data sensitif kandidat LPK Bandung",
    seen["lpk2-admin"].priv.length === 0 && seen["lpk2-admin"].docs === 0 && seen["lpk2-admin"].edu === 0,
  );
  for (const who of ["tsk-admin", "tsk-staff"]) {
    check(
      `${who === "tsk-admin" ? "Admin" : "Staf"} TSK: membaca data sensitif + dokumen + keluarga kandidat mitra (READY dan STUDYING)`,
      sorted(seen[who].priv) === sorted([ready1, studying1].map(nikOf)) && seen[who].docs === 1 && seen[who].family === 1,
      `NIK: ${seen[who].priv.length} baris, dokumen ${seen[who].docs}`,
    );
  }
  check(
    "TSK: tanpa persetujuan / LPK non-mitra -> data sensitif & dokumennya tidak terlihat",
    !seen["tsk-admin"].priv.includes(nikOf(hidden)) && !seen["tsk-admin"].priv.includes(nikOf(outsider)) && seen["tsk-admin"].docs === 1,
  );

  // --- B. Siapa boleh MENULIS apa, di setiap tahap ---
  type Wrote = { cand: boolean; priv: boolean; docIns: boolean; docDel: boolean };
  type Staged = { stageOnly: boolean; stageAndData: boolean };
  const wrote: Record<string, Wrote> = {};
  const staged: Record<string, Staged> = {};
  await sandbox(async (tx) => {
    await tx.insert(candidatePrivate).values({ candidateId: ready1.id, nationalId: NIK, phone: "0812" });
    const roles: Array<[string, string]> = [
      ["TSK_ADMIN", tsk.id],
      ["TSK_STAFF", tsk.id],
      ["LPK_ADMIN", lpk1.id],
      ["LPK_SENSEI", lpk1.id],
    ];
    for (const stage of candidateStage.enumValues) {
      await actAsSystem(tx);
      await tx.update(candidates).set({ stage }).where(eq(candidates.id, ready1.id));
      const [baseDoc] = await tx.insert(candidateDocuments).values(sampleDoc(ready1.id)).returning();
      const nextStage = stage === "READY" ? "SHORTLISTED" : "READY";
      for (const [role, orgId] of roles) {
        // Tiap peran diuji di savepoint sendiri yang di-rollback, supaya hasil peran lain tidak terpengaruh.
        await scratch(tx, async (sp) => {
          await actAs(sp, orgId, role);
          const c = await rowsOf(sp, (t) => t.update(candidates).set({ hobby: `diubah ${role}` }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }));
          const p = await rowsOf(sp, (t) => t.update(candidatePrivate).set({ phone: `0899-${role}` }).where(eq(candidatePrivate.candidateId, ready1.id)).returning({ id: candidatePrivate.candidateId }));
          const di = await rowsOf(sp, (t) => t.insert(candidateDocuments).values(sampleDoc(ready1.id)).returning({ id: candidateDocuments.id }));
          const dd = await rowsOf(sp, (t) => t.delete(candidateDocuments).where(eq(candidateDocuments.id, baseDoc.id)).returning({ id: candidateDocuments.id }));
          wrote[`${stage}/${role}`] = { cand: c.n > 0, priv: p.n > 0, docIns: di.n > 0, docDel: dd.n > 0 };
        });
        await scratch(tx, async (sp) => {
          await actAs(sp, orgId, role);
          const so = await rowsOf(sp, (t) => t.update(candidates).set({ stage: nextStage }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }));
          staged[`${stage}/${role}/only`] = { stageOnly: so.n > 0, stageAndData: false };
        });
        await scratch(tx, async (sp) => {
          await actAs(sp, orgId, role);
          const sd = await rowsOf(sp, (t) => t.update(candidates).set({ stage: nextStage, hobby: `campur ${role}` }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }));
          staged[`${stage}/${role}/mixed`] = { stageOnly: false, stageAndData: sd.n > 0 };
        });
      }
    }
  });
  const NONE: Wrote = { cand: false, priv: false, docIns: false, docDel: false };
  const FULL: Wrote = { cand: true, priv: true, docIns: true, docDel: true };
  const wrongStages = (pred: (stage: string) => boolean, who: string, expect: Wrote) =>
    candidateStage.enumValues.filter((s) => pred(s) && JSON.stringify(wrote[`${s}/${who}`]) !== JSON.stringify(expect));
  const stagesOf = (pred: (s: string) => boolean) => candidateStage.enumValues.filter(pred);

  for (const who of ["TSK_ADMIN", "TSK_STAFF"]) {
    // Ubah tahap: boleh di tahap apa pun
    const badStage = stagesOf(() => true).filter((s) => !staged[`${s}/${who}/only`].stageOnly);
    check(
      `${who}: BISA mengubah stage kandidat di tahap apa pun (STUDYING -> READY dst.)`,
      badStage.length === 0,
      badStage.length ? `ditolak di: ${badStage.join(", ")}` : `${candidateStage.enumValues.length} tahap diperiksa`,
    );
    // Edit isi data: hanya di tahap yang diizinkan
    const bad1 = wrongStages((s) => !TSK_EDITABLE.includes(s), who, NONE);
    check(
      `${who}: TIDAK bisa mengedit nama/data sensitif/dokumen di tahap selain ${TSK_EDITABLE.join(" / ")}`,
      bad1.length === 0,
      bad1.length ? `salah di: ${bad1.join(", ")}` : `${candidateStage.enumValues.length - TSK_EDITABLE.length} tahap ditolak (termasuk STUDYING & WITHDRAWN)`,
    );
    const bad2 = wrongStages((s) => TSK_EDITABLE.includes(s), who, FULL);
    check(
      `${who}: BISA mengedit data + data sensitif + dokumen (tambah & hapus) pada ${TSK_EDITABLE.join(" / ")}`,
      bad2.length === 0,
      bad2.length ? `salah di: ${bad2.join(", ")}` : "kandidat, candidate_private, dokumen",
    );
    // Stage + kolom lain sekaligus: dinilai dari stage baris LAMA
    const badMixed = stagesOf(() => true).filter(
      (s) => staged[`${s}/${who}/mixed`].stageAndData !== TSK_EDITABLE.includes(s),
    );
    check(
      `${who}: mengubah stage BERSAMA kolom lain hanya lolos bila stage lama termasuk tahap yang boleh diedit`,
      badMixed.length === 0,
      badMixed.length ? `salah di: ${badMixed.join(", ")}` : "",
    );
  }
  const only = (stage: string, role: string) => JSON.stringify(wrote[`${stage}/${role}`]);
  check(
    "TSK bisa mengedit data di PASSED_CLIENT_INTERVIEW",
    only("PASSED_CLIENT_INTERVIEW", "TSK_ADMIN") === JSON.stringify(FULL) && only("PASSED_CLIENT_INTERVIEW", "TSK_STAFF") === JSON.stringify(FULL),
  );
  check(
    "TSK ditolak mengedit nama/data sensitif kandidat STUDYING",
    only("STUDYING", "TSK_ADMIN") === JSON.stringify(NONE) && only("STUDYING", "TSK_STAFF") === JSON.stringify(NONE),
  );
  check(
    "TSK ditolak mengedit di WITHDRAWN (walau urutan enum-nya paling akhir)",
    only("WITHDRAWN", "TSK_ADMIN") === JSON.stringify(NONE) && only("WITHDRAWN", "TSK_STAFF") === JSON.stringify(NONE),
  );
  const badAdmin = wrongStages(() => true, "LPK_ADMIN", FULL);
  check("Admin LPK: bisa mengedit data + dokumen di semua tahap", badAdmin.length === 0, badAdmin.join(", "));
  const badSensei = wrongStages(() => true, "LPK_SENSEI", NONE);
  const senseiStage = stagesOf(() => true).filter((s) => staged[`${s}/LPK_SENSEI/only`].stageOnly);
  check(
    "Sensei: tidak bisa mengedit data/dokumen maupun mengubah stage di tahap apa pun",
    badSensei.length === 0 && senseiStage.length === 0,
    [...badSensei, ...senseiStage].join(", "),
  );
  check(
    "Admin LPK: bisa mengubah stage di semua tahap",
    stagesOf(() => true).every((s) => staged[`${s}/LPK_ADMIN/only`].stageOnly && staged[`${s}/LPK_ADMIN/mixed`].stageAndData),
  );

  // --- C. Trigger database saja (RLS dilewati, app.role diisi) ---
  const trig: Record<string, string | null> = {};
  let seq = 0;
  const uniq = () => `uji-${++seq}`; // update ke nilai yang sama bukan perubahan, jadi selalu pakai nilai baru
  await sandbox(async (tx) => {
    await tx.insert(candidatePrivate).values({ candidateId: ready1.id, nationalId: NIK, phone: "0812" });
    const at = async (stage: string) => {
      await actAsSystem(tx);
      await tx.update(candidates).set({ stage: stage as (typeof candidateStage.enumValues)[number] }).where(eq(candidates.id, ready1.id));
      await actAsTriggerOnly(tx, "TSK_STAFF");
    };
    await at("READY");
    trig.nameReady = await attempt(tx, (t) => t.update(candidates).set({ fullName: uniq() }).where(eq(candidates.id, ready1.id)));
    trig.stageOnlyReady = await attempt(tx, (t) => t.update(candidates).set({ stage: "SHORTLISTED" }).where(eq(candidates.id, ready1.id)));
    await at("READY");
    trig.mixedReady = await attempt(tx, (t) => t.update(candidates).set({ stage: "SHORTLISTED", fullName: uniq() }).where(eq(candidates.id, ready1.id)));
    trig.privReady = await attempt(tx, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, ready1.id)));
    await at("PASSED_CLIENT_INTERVIEW");
    trig.namePassed = await attempt(tx, (t) => t.update(candidates).set({ fullName: uniq() }).where(eq(candidates.id, ready1.id)));
    trig.privPassed = await attempt(tx, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, ready1.id)));
    await at("WITHDRAWN");
    trig.nameWithdrawn = await attempt(tx, (t) => t.update(candidates).set({ fullName: uniq() }).where(eq(candidates.id, ready1.id)));
    trig.privWithdrawn = await attempt(tx, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, ready1.id)));
    await at("STUDYING");
    await actAsTriggerOnly(tx, "LPK_ADMIN");
    trig.adminStudying = await attempt(tx, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, ready1.id)));
  });
  check(
    "Trigger candidates: TSK di tahap READY hanya boleh mengubah stage (nama & stage+nama ditolak)",
    trig.nameReady !== null && /hanya boleh mengubah tahap/.test(trig.nameReady) && trig.stageOnlyReady === null && trig.mixedReady !== null,
    trig.nameReady ?? "",
  );
  check(
    "Trigger candidate_private: TSK ditolak di READY & WITHDRAWN, diterima di PASSED_CLIENT_INTERVIEW (candidates: sama)",
    trig.privReady !== null && /data sensitif/.test(trig.privReady) && trig.privWithdrawn !== null &&
      trig.privPassed === null && trig.namePassed === null && trig.nameWithdrawn !== null,
    trig.privReady ?? "",
  );
  check("Trigger: LPK_ADMIN tidak dibatasi (edit data sensitif di STUDYING)", trig.adminStudying === null, trig.adminStudying ?? "");

  // --- D. Persetujuan berbagi data menentukan keterlihatan bagi TSK ---
  const vis: Record<string, { cand: number; priv: number; docs: number }> = {};
  const consentRules: Record<string, string | null> = {};
  await sandbox(async (tx) => {
    await tx.insert(candidatePrivate).values({ candidateId: ready1.id, nationalId: NIK });
    await tx.insert(candidateDocuments).values(sampleDoc(ready1.id));
    const tskSees = async (label: string) => {
      await actAs(tx, tsk.id, "TSK_ADMIN");
      vis[label] = {
        cand: (await tx.select().from(candidates).where(eq(candidates.id, ready1.id))).length,
        priv: (await tx.select().from(candidatePrivate).where(eq(candidatePrivate.candidateId, ready1.id))).length,
        docs: (await tx.select().from(candidateDocuments).where(eq(candidateDocuments.candidateId, ready1.id))).length,
      };
    };
    await tskSees("dengan persetujuan");
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    await tx.update(candidates).set({ dataConsentDate: null }).where(eq(candidates.id, ready1.id));
    await tskSees("persetujuan dicabut");
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    const own = await tx.select().from(candidates).where(eq(candidates.id, ready1.id));
    vis["pemilik"] = { cand: own.length, priv: (await tx.select().from(candidatePrivate).where(eq(candidatePrivate.candidateId, ready1.id))).length, docs: 0 };
    await tx.update(candidates).set({ dataConsentDate: "2026-09-01" }).where(eq(candidates.id, ready1.id));
    await tskSees("persetujuan diberikan lagi");

    // LPK boleh menyimpan READY tanpa persetujuan (aturan lama dihapus), tetapi TSK tidak melihatnya
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    consentRules.insertReady = await attempt(tx, (t) => t.insert(candidates).values({ organizationId: lpk1.id, fullName: "Ready Tanpa Persetujuan", stage: "READY" }));
    await actAs(tx, tsk.id, "TSK_ADMIN");
    vis["ready tanpa persetujuan"] = {
      cand: (await tx.select().from(candidates).where(eq(candidates.fullName, "Ready Tanpa Persetujuan"))).length,
      priv: 0,
      docs: 0,
    };
    // TSK tidak bisa menghapus tanggal persetujuan (akan menyembunyikan kandidat dari dirinya sendiri)
    await actAsSystem(tx);
    await tx.update(candidates).set({ stage: "PASSED_CLIENT_INTERVIEW" }).where(eq(candidates.id, ready1.id));
    await actAs(tx, tsk.id, "TSK_ADMIN");
    consentRules.tskClears = await attempt(tx, (t) => t.update(candidates).set({ dataConsentDate: null }).where(eq(candidates.id, ready1.id)));
  });
  check(
    "Persetujuan dicabut -> kandidat, data sensitif, dan dokumen langsung hilang dari TSK; kembali saat diberikan lagi",
    JSON.stringify(vis["dengan persetujuan"]) === JSON.stringify({ cand: 1, priv: 1, docs: 1 }) &&
      JSON.stringify(vis["persetujuan dicabut"]) === JSON.stringify({ cand: 0, priv: 0, docs: 0 }) &&
      JSON.stringify(vis["persetujuan diberikan lagi"]) === JSON.stringify({ cand: 1, priv: 1, docs: 1 }),
    Object.entries(vis).map(([k, v]) => `${k}: ${v.cand}/${v.priv}/${v.docs}`).join(" | "),
  );
  check("Pemilik (LPK) tetap melihat kandidat & data sensitifnya walau tanpa persetujuan", vis["pemilik"].cand === 1 && vis["pemilik"].priv === 1);
  check(
    "READY tanpa persetujuan: database menerima (aturan lama dihapus), tetapi TSK tidak melihatnya",
    consentRules.insertReady === null && vis["ready tanpa persetujuan"].cand === 0,
    consentRules.insertReady ?? "",
  );
  check(
    "TSK tidak bisa menghapus tanggal persetujuan kandidat",
    consentRules.tskClears !== null && /row-level security/i.test(consentRules.tskClears),
    consentRules.tskClears ?? "",
  );

  // --- E. Hal yang tetap tidak boleh: tambah kandidat, pindah LPK, pindah dokumen ---
  const senseiInsertErr = await inRollback(() =>
    withTenant(lpk1.id, "LPK_SENSEI", (tx) => tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Dari Sensei" }), db),
  );
  check("Sensei: tidak bisa menambah kandidat", senseiInsertErr !== null && /row-level security/i.test(senseiInsertErr), senseiInsertErr ?? "");
  const tskInsertErr = await inRollback(() =>
    withTenant(tsk.id, "TSK_ADMIN", (tx) => tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Dari TSK" }), db),
  );
  check("TSK: tidak bisa menambah kandidat", tskInsertErr !== null && /row-level security/i.test(tskInsertErr), tskInsertErr ?? "");
  const tskDeleteErr = await withTenant(tsk.id, "TSK_ADMIN", (tx) => tx.delete(candidates).where(eq(candidates.id, ready1.id)).returning(), db);
  check("TSK: tidak bisa menghapus kandidat", tskDeleteErr.length === 0);

  const escapes: Record<string, string | null> = {};
  await sandbox(async (tx) => {
    await tx.update(candidates).set({ stage: "PASSED_CLIENT_INTERVIEW" }).where(eq(candidates.id, ready1.id));
    await tx.insert(candidateDocuments).values(sampleDoc(ready1.id));
    const otherLpk1 = all.find((c) => c.organizationId === lpk1.id && c.id !== ready1.id)!;
    await actAs(tx, tsk.id, "TSK_ADMIN");
    escapes.toLpk2 = await attempt(tx, (t) => t.update(candidates).set({ organizationId: lpk2.id }).where(eq(candidates.id, ready1.id)));
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    escapes.docMove = await attempt(tx, (t) => t.update(candidateDocuments).set({ candidateId: otherLpk1.id }).where(eq(candidateDocuments.candidateId, ready1.id)));
  });
  check("TSK: tidak bisa memindahkan kandidat ke LPK mitra lain", escapes.toLpk2 !== null && /dipindahkan|row-level security/.test(escapes.toLpk2), escapes.toLpk2 ?? "");
  check("Dokumen tidak bisa dipindahkan ke kandidat lain", escapes.docMove !== null && /dipindahkan/.test(escapes.docMove), escapes.docMove ?? "");

  // --- F. Batas dokumen dijaga database ---
  const docRules: Record<string, string | null> = {};
  await sandbox(async (tx) => {
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    const base = sampleDoc(ready1.id);
    docRules.valid = await attempt(tx, (t) => t.insert(candidateDocuments).values({ ...base, sizeBytes: 10 * 1024 * 1024 }));
    docRules.html = await attempt(tx, (t) => t.insert(candidateDocuments).values({ ...base, mimeType: "text/html" }));
    docRules.tooBig = await attempt(tx, (t) => t.insert(candidateDocuments).values({ ...base, sizeBytes: 10 * 1024 * 1024 + 1 }));
    docRules.empty = await attempt(tx, (t) => t.insert(candidateDocuments).values({ ...base, sizeBytes: 0 }));
  });
  check(
    "Dokumen: PDF/JPG/PNG sampai 10 MB diterima; tipe lain, >10 MB, dan 0 byte ditolak",
    docRules.valid === null && [docRules.html, docRules.tooBig, docRules.empty].every((e) => e !== null && /check/i.test(e)),
    docRules.valid ?? "",
  );

  // --- G. Audit: aksi TSK tercatat atas nama organisasinya sendiri ---
  const auditRes: Record<string, string | null> = {};
  await sandbox(async (tx) => {
    await actAs(tx, tsk.id, "TSK_ADMIN");
    const row = (organizationId: string, action: string) => ({
      organizationId,
      actorUserId: tskAdminUser.id,
      action,
      entity: "candidate",
      entityId: ready1.id,
      before: { stage: "STUDYING" },
      after: { stage: "READY" },
    });
    auditRes.own = await attempt(tx, (t) => t.insert(auditLogs).values([row(tsk.id, "candidate.change_stage"), row(tsk.id, "document.download")]));
    auditRes.forged = await attempt(tx, (t) => t.insert(auditLogs).values(row(lpk1.id, "candidate.change_stage")));
  });
  check(
    "Audit log: TSK bisa mencatat ubah tahap & unduh dokumen untuk organisasinya, tidak untuk organisasi lain",
    auditRes.own === null && auditRes.forged !== null && /row-level security/i.test(auditRes.forged),
    auditRes.own ?? "",
  );

  await pool.end();
  console.log(failures === 0 ? "\nSemua pemeriksaan RLS lulus." : `\n${failures} pemeriksaan GAGAL.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exit(1);
});
