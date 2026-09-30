// Uji isolasi data (Row-Level Security) dengan role aplikasi `hashi_app`.
// Pemakaian: npm run test:rls   (butuh DATABASE_URL dan data seed demo)
//
// Setiap pemeriksaan memastikan satu aturan dari spesifikasi:
// LPK hanya melihat kandidatnya; TSK melihat kandidat LPK mitra di semua tahap TAPI hanya
// yang sudah punya persetujuan berbagi data; tidak ada yang bisa menulis ke data organisasi
// lain; sensei tidak bisa membaca data sensitif/dokumen; status LPK (candidates.stage) hanya
// diubah LPK_ADMIN; keputusan TSK ada di candidate_selections (tiap TSK hanya melihat/menulis
// miliknya); TSK mengedit isi data hanya jika keputusannya PASSED_CLIENT_INTERVIEW,
// DOCUMENT_PROCESS, atau DEPARTED dan kandidat belum WITHDRAWN.
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
  candidateNotes,
  candidateSelections,
  candidateStage,
  organizations,
  partnerships,
  selectionDecision,
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
  const seededSelections = await withSystem((tx) => tx.select().from(candidateSelections), db);
  const hasSelection = (id: string) => seededSelections.some((s) => s.candidateId === id);

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

  // 4. TSK tidak bisa mengubah isi data kandidat yang keputusannya belum PASSED_CLIENT_INTERVIEW dst.
  //    (pemeriksaan lengkap per keputusan ada di bagian "Profil kandidat" di bawah)
  const target = tskRows.find((r) => r.stage === "READY" && !hasSelection(r.id))!;
  const updated = await withTenant(tsk.id, "TSK_ADMIN",
    (tx) => tx.update(candidates).set({ fullName: "DIUBAH TSK" }).where(eq(candidates.id, target.id)).returning(),
    db,
  );
  check("TSK: tidak bisa mengubah nama kandidat yang belum diputuskan", updated.length === 0);

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
  // Profil kandidat: status LPK (stage) vs keputusan TSK (candidate_selections)
  // ==========================================================================
  const EDIT_DECISIONS = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"]; // sengaja ditulis eksplisit
  const consented = (c: (typeof all)[number]) => c.dataConsentDate !== null;
  const pick = (org: string, stage: string) =>
    all.find((c) => c.organizationId === org && c.stage === stage && consented(c) && !hasSelection(c.id))!;
  const ready1 = pick(lpk1.id, "READY");
  const studying1 = pick(lpk1.id, "STUDYING");
  const withdrawn1 = pick(lpk1.id, "WITHDRAWN");
  const outsider = pick(lpk3.id, "READY");
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
  let seq = 0;
  const uniq = () => `uji-${++seq}`; // update ke nilai yang sama bukan perubahan, jadi selalu pakai nilai baru

  async function sandbox(fn: (tx: Tx) => Promise<void>) {
    await errorMessage(() =>
      withSystem(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }, db),
    );
  }
  /** TSK kedua (mitra LPK Bandung) untuk menguji isolasi antar-TSK. Dipanggil dalam mode sistem. */
  async function makeTskB(tx: Tx) {
    const [org] = await tx.insert(organizations).values({ name: "TSK Uji B", type: "TSK", country: "JP", defaultLocale: "ja" }).returning();
    await tx.insert(partnerships).values({ lpkId: lpk1.id, tskId: org.id });
    return org.id;
  }
  const decide = (tx: Tx, candidateId: string, tskOrgId: string, decision: (typeof selectionDecision.enumValues)[number]) =>
    tx
      .insert(candidateSelections)
      .values({ candidateId, tskOrgId, decision })
      .onConflictDoUpdate({ target: [candidateSelections.candidateId, candidateSelections.tskOrgId], set: { decision } })
      .returning();

  // --- A. Siapa boleh MEMBACA apa (data sensitif & dokumen) ---
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
    sorted(seen["lpk1-admin"].priv) === sorted([ready1, studying1, hidden].map(nikOf)) &&
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
    `kandidat ${seen["lpk1-sensei"].cands}/${ownCount(lpk1.id)}`,
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

  // --- B. TSK membuat keputusan; status LPK tidak ikut berubah ---
  const dec: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    await actAs(tx, tsk.id, "TSK_STAFF");
    const made = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: studying1.id, tskOrgId: tsk.id, decision: "SHORTLISTED", decidedBy: tskAdminUser.id }));
    dec.made = made;
    dec.readBack = (await tx.select().from(candidateSelections).where(eq(candidateSelections.candidateId, studying1.id))).map((s) => s.decision);
    dec.changed = await attempt(tx, (t) => t.update(candidateSelections).set({ decision: "PASSED_TSK_INTERVIEW" }).where(eq(candidateSelections.candidateId, studying1.id)));
    dec.readBack2 = (await tx.select().from(candidateSelections).where(eq(candidateSelections.candidateId, studying1.id))).map((s) => s.decision);
    await actAsSystem(tx);
    dec.lpkStage = (await tx.select().from(candidates).where(eq(candidates.id, studying1.id)))[0].stage;
    // kandidat yang tidak terlihat TSK: tanpa persetujuan, atau LPK non-mitra
    await actAs(tx, tsk.id, "TSK_ADMIN");
    dec.hidden = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: hidden.id, tskOrgId: tsk.id, decision: "SHORTLISTED" }));
    dec.outsider = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: outsider.id, tskOrgId: tsk.id, decision: "SHORTLISTED" }));
    // atas nama TSK lain
    dec.forged = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: ready1.id, tskOrgId: lpk1.id, decision: "SHORTLISTED" }));
    dec.keyMove = await attempt(tx, (t) => t.update(candidateSelections).set({ candidateId: ready1.id }).where(eq(candidateSelections.candidateId, studying1.id)));
    dec.del = await attempt(tx, (t) => t.delete(candidateSelections).where(eq(candidateSelections.candidateId, studying1.id)));
  });
  check(
    "TSK bisa membuat keputusan SHORTLISTED untuk kandidat STUDYING, dan status LPK-nya tetap STUDYING",
    dec.made === null && JSON.stringify(dec.readBack) === '["SHORTLISTED"]' && dec.changed === null &&
      JSON.stringify(dec.readBack2) === '["PASSED_TSK_INTERVIEW"]' && dec.lpkStage === "STUDYING",
    `keputusan: ${JSON.stringify(dec.readBack)} -> ${JSON.stringify(dec.readBack2)}, status LPK: ${dec.lpkStage}`,
  );
  check(
    "TSK tidak bisa memutuskan kandidat tanpa persetujuan data atau dari LPK non-mitra",
    typeof dec.hidden === "string" && /row-level security/.test(dec.hidden) &&
      typeof dec.outsider === "string" && /row-level security/.test(dec.outsider),
  );
  check(
    "TSK tidak bisa menulis keputusan atas nama organisasi lain, memindahkan, atau menghapusnya",
    typeof dec.forged === "string" && /row-level security/.test(dec.forged) &&
      typeof dec.keyMove === "string" && typeof dec.del === "string" && /permission denied/.test(dec.del as string),
    `${(dec.keyMove as string | null)?.slice(0, 60)} | ${(dec.del as string | null)?.slice(0, 40)}`,
  );

  // --- C. Siapa boleh MENGEDIT isi data: matriks status LPK x keputusan TSK ---
  type Ops = { cand: boolean; priv: boolean; docIns: boolean; docUpd: boolean; docDel: boolean; famIns: boolean };
  const ops: Record<string, Ops> = {};
  async function measure(sp: Tx, candId: string, docId: string): Promise<Ops> {
    const c = await rowsOf(sp, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, candId)).returning({ id: candidates.id }));
    const p = await rowsOf(sp, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, candId)).returning({ id: candidatePrivate.candidateId }));
    const di = await rowsOf(sp, (t) => t.insert(candidateDocuments).values(sampleDoc(candId)).returning({ id: candidateDocuments.id }));
    const du = await rowsOf(sp, (t) => t.update(candidateDocuments).set({ expiryDate: "2030-01-01" }).where(eq(candidateDocuments.id, docId)).returning({ id: candidateDocuments.id }));
    const dd = await rowsOf(sp, (t) => t.delete(candidateDocuments).where(eq(candidateDocuments.id, docId)).returning({ id: candidateDocuments.id }));
    const fi = await rowsOf(sp, (t) => t.insert(candidateFamilyMembers).values({ candidateId: candId, relation: "FATHER", name: uniq() }).returning({ id: candidateFamilyMembers.id }));
    return { cand: c.n > 0, priv: p.n > 0, docIns: di.n > 0, docUpd: du.n > 0, docDel: dd.n > 0, famIns: fi.n > 0 };
  }
  await sandbox(async (tx) => {
    await tx.insert(candidatePrivate).values([{ candidateId: ready1.id, nationalId: NIK, phone: "0812" }, { candidateId: studying1.id, nationalId: NIK, phone: "0812" }]);
    for (const stage of candidateStage.enumValues) {
      for (const decision of selectionDecision.enumValues) {
        await actAsSystem(tx);
        await tx.update(candidates).set({ stage }).where(eq(candidates.id, ready1.id));
        await decide(tx, ready1.id, tsk.id, decision);
        const [doc] = await tx.insert(candidateDocuments).values(sampleDoc(ready1.id)).returning();
        for (const role of ["TSK_ADMIN", "TSK_STAFF"]) {
          await scratch(tx, async (sp) => {
            await actAs(sp, tsk.id, role);
            ops[`${stage}/${decision}/${role}`] = await measure(sp, ready1.id, doc.id);
          });
        }
      }
      // LPK: tidak bergantung pada keputusan TSK
      await actAsSystem(tx);
      await tx.update(candidates).set({ stage }).where(eq(candidates.id, ready1.id));
      const [doc] = await tx.insert(candidateDocuments).values(sampleDoc(ready1.id)).returning();
      for (const role of ["LPK_ADMIN", "LPK_SENSEI"]) {
        await scratch(tx, async (sp) => {
          await actAs(sp, lpk1.id, role);
          ops[`${stage}/-/${role}`] = await measure(sp, ready1.id, doc.id);
        });
      }
    }
    // TSK yang BELUM punya baris keputusan sama sekali
    await actAsSystem(tx);
    const [doc] = await tx.insert(candidateDocuments).values(sampleDoc(studying1.id)).returning();
    await scratch(tx, async (sp) => {
      await actAs(sp, tsk.id, "TSK_ADMIN");
      ops["tanpa-baris-keputusan"] = await measure(sp, studying1.id, doc.id);
    });
  });
  const opsOf = (allowed: boolean, canDelete = false): Ops => ({ cand: allowed, priv: allowed, docIns: allowed, docUpd: allowed, docDel: canDelete, famIns: allowed });
  const wrongKeys = (keys: string[], expected: (k: string) => Ops) =>
    keys.filter((k) => JSON.stringify(ops[k]) !== JSON.stringify(expected(k)));

  for (const role of ["TSK_ADMIN", "TSK_STAFF"]) {
    const combos = candidateStage.enumValues.flatMap((s) => selectionDecision.enumValues.map((d) => ({ s, d, k: `${s}/${d}/${role}` })));
    // Aturan: bisa mengedit <=> keputusan IN (...) DAN status LPK bukan WITHDRAWN. Tidak pernah bisa menghapus.
    const bad = wrongKeys(combos.map((c) => c.k), (k) => {
      const [s, d] = k.split("/");
      return opsOf(EDIT_DECISIONS.includes(d) && s !== "WITHDRAWN");
    });
    check(
      `${role}: hak edit = keputusan IN (${EDIT_DECISIONS.join(", ")}) dan LPK belum WITHDRAWN; tidak pernah bisa menghapus`,
      bad.length === 0,
      bad.length ? `salah di: ${bad.slice(0, 4).join(", ")}` : `${combos.length} kombinasi status x keputusan diperiksa, 6 operasi tiap kombinasi`,
    );
    const noDecision = candidateStage.enumValues.filter((s) => ["NONE", "SHORTLISTED", "PASSED_TSK_INTERVIEW", "SUBMITTED_TO_CLIENT", "REJECTED"].some((d) => JSON.stringify(ops[`${s}/${d}/${role}`]) !== JSON.stringify(opsOf(false))));
    check(
      `${role}: ditolak mengedit nama, candidate_private, dan dokumen sebelum keputusan PASSED_CLIENT_INTERVIEW`,
      noDecision.length === 0,
      "NONE, SHORTLISTED, PASSED_TSK_INTERVIEW, SUBMITTED_TO_CLIENT, REJECTED di semua status LPK",
    );
    check(
      `${role}: bisa mengedit setelah keputusan PASSED_CLIENT_INTERVIEW (juga DOCUMENT_PROCESS, DEPARTED)`,
      ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"].every((d) =>
        ["STUDYING", "READY"].every((s) => JSON.stringify(ops[`${s}/${d}/${role}`]) === JSON.stringify(opsOf(true))),
      ),
    );
    check(
      `${role}: ditolak mengedit kandidat WITHDRAWN walau keputusannya PASSED_CLIENT_INTERVIEW`,
      ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"].every((d) => JSON.stringify(ops[`WITHDRAWN/${d}/${role}`]) === JSON.stringify(opsOf(false))),
    );
  }
  check(
    "TSK tanpa baris keputusan: tidak bisa mengedit apa pun",
    JSON.stringify(ops["tanpa-baris-keputusan"]) === JSON.stringify(opsOf(false)),
  );
  const badAdmin = wrongKeys(candidateStage.enumValues.map((s) => `${s}/-/LPK_ADMIN`), () => opsOf(true, true));
  check("Admin LPK: bisa mengedit dan menghapus di semua status (WITHDRAWN pun)", badAdmin.length === 0, badAdmin.join(", "));
  const badSensei = wrongKeys(candidateStage.enumValues.map((s) => `${s}/-/LPK_SENSEI`), () => opsOf(false));
  check("Sensei: tidak bisa mengedit data maupun dokumen di status apa pun", badSensei.length === 0, badSensei.join(", "));

  // --- D. Status LPK & persetujuan hanya milik LPK ---
  const stg: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    // TSK dengan hak edit (keputusan PASSED_CLIENT_INTERVIEW) tetap tidak boleh menyentuh stage / persetujuan
    await decide(tx, ready1.id, tsk.id, "PASSED_CLIENT_INTERVIEW");
    await actAs(tx, tsk.id, "TSK_ADMIN");
    stg.stageTsk = await attempt(tx, (t) => t.update(candidates).set({ stage: "WITHDRAWN" }).where(eq(candidates.id, ready1.id)));
    stg.consentTsk = await attempt(tx, (t) => t.update(candidates).set({ dataConsentDate: null }).where(eq(candidates.id, ready1.id)));
    stg.consentTsk2 = await attempt(tx, (t) => t.update(candidates).set({ dataConsentDate: "2020-01-01" }).where(eq(candidates.id, ready1.id)));
    stg.hobbyTsk = await attempt(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, ready1.id)));
    // TSK tanpa hak edit: UPDATE stage tidak menyentuh baris sama sekali
    stg.noRightsRows = (await rowsOf(tx, (t) => t.update(candidates).set({ stage: "READY" }).where(eq(candidates.id, studying1.id)).returning({ id: candidates.id }))).n;
    // Trigger saja (RLS dilewati, app.role TSK)
    await actAsTriggerOnly(tx, "TSK_STAFF");
    stg.trigStage = await attempt(tx, (t) => t.update(candidates).set({ stage: "WITHDRAWN" }).where(eq(candidates.id, studying1.id)));
    stg.trigHobby = await attempt(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, studying1.id)));
    await actAsTriggerOnly(tx, "LPK_ADMIN");
    stg.trigAdmin = await attempt(tx, (t) => t.update(candidates).set({ stage: "READY" }).where(eq(candidates.id, studying1.id)));
    // LPK_ADMIN mengubah ke semua status; sensei tidak bisa
    for (const stage of candidateStage.enumValues) {
      await actAs(tx, lpk1.id, "LPK_ADMIN");
      stg[`admin-${stage}`] = (await rowsOf(tx, (t) => t.update(candidates).set({ stage }).where(eq(candidates.id, studying1.id)).returning({ id: candidates.id }))).n;
      await actAs(tx, lpk1.id, "LPK_SENSEI");
      stg[`sensei-${stage}`] = (await rowsOf(tx, (t) => t.update(candidates).set({ stage: stage === "READY" ? "STUDYING" : "READY" }).where(eq(candidates.id, studying1.id)).returning({ id: candidates.id }))).n;
    }
    // LPK boleh menyimpan READY tanpa persetujuan (database tidak menolaknya), tetapi TSK tidak melihatnya
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    stg.readyNoConsent = await attempt(tx, (t) => t.insert(candidates).values({ organizationId: lpk1.id, fullName: "Ready Tanpa Persetujuan", stage: "READY" }));
    await actAs(tx, tsk.id, "TSK_ADMIN");
    stg.readyNoConsentSeen = (await tx.select().from(candidates).where(eq(candidates.fullName, "Ready Tanpa Persetujuan"))).length;
    // LPK mencabut persetujuan: kandidat, keputusan, dan hak edit TSK langsung hilang
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    await tx.update(candidates).set({ dataConsentDate: null }).where(eq(candidates.id, ready1.id));
    await actAs(tx, tsk.id, "TSK_ADMIN");
    stg.revokedCand = (await tx.select().from(candidates).where(eq(candidates.id, ready1.id))).length;
    stg.revokedSel = (await tx.select().from(candidateSelections).where(eq(candidateSelections.candidateId, ready1.id))).length;
    stg.revokedEdit = (await rowsOf(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
  });
  check(
    "TSK tidak bisa mengubah candidates.stage (walau punya hak edit), tanggal persetujuan, tetapi kolom data lain bisa",
    [stg.stageTsk, stg.consentTsk, stg.consentTsk2].every((e) => typeof e === "string" && /hanya bisa diubah oleh LPK/.test(e)) && stg.hobbyTsk === null,
    typeof stg.stageTsk === "string" ? stg.stageTsk : "",
  );
  check("TSK tanpa hak edit: UPDATE stage tidak mengenai baris (0 baris)", stg.noRightsRows === 0);
  check(
    "Trigger (RLS dilewati): TSK ditolak mengubah stage, LPK_ADMIN tidak dibatasi",
    typeof stg.trigStage === "string" && /hanya bisa diubah oleh LPK/.test(stg.trigStage) && stg.trigHobby === null && stg.trigAdmin === null,
  );
  check(
    "Admin LPK bisa mengubah stage ke STUDYING / READY / WITHDRAWN; sensei tidak bisa",
    candidateStage.enumValues.every((s) => stg[`admin-${s}`] === 1 && stg[`sensei-${s}`] === 0),
  );
  check(
    "READY tanpa persetujuan: database menerima, tetapi TSK tidak melihatnya",
    stg.readyNoConsent === null && stg.readyNoConsentSeen === 0,
    typeof stg.readyNoConsent === "string" ? stg.readyNoConsent : "",
  );
  check(
    "Persetujuan dicabut LPK: kandidat, keputusan TSK, dan hak edit langsung hilang dari TSK",
    stg.revokedCand === 0 && stg.revokedSel === 0 && stg.revokedEdit === 0,
    `kandidat ${stg.revokedCand}, keputusan ${stg.revokedSel}, edit ${stg.revokedEdit}`,
  );

  // --- E. Dua TSK: keputusan terpisah per TSK; LPK membaca keputusan semua TSK mitranya ---
  const iso: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const [selA] = await decide(tx, ready1.id, tsk.id, "SHORTLISTED");
    const [selB] = await decide(tx, ready1.id, tskB, "PASSED_CLIENT_INTERVIEW");
    await tx.insert(candidatePrivate).values({ candidateId: ready1.id, nationalId: NIK, phone: "0812" });

    const sees = async (label: string, orgId: string, role: string | null) => {
      await actAs(tx, orgId, role);
      iso[label] = {
        sel: (await tx.select().from(candidateSelections)).filter((s) => s.candidateId === ready1.id).map((s) => `${s.tskOrgId === tsk.id ? "A" : s.tskOrgId === tskB ? "B" : "?"}:${s.decision}`).sort(),
      };
    };
    await sees("A", tsk.id, "TSK_ADMIN");
    await sees("B", tskB, "TSK_STAFF");
    await sees("lpk-admin", lpk1.id, "LPK_ADMIN");
    await sees("lpk-sensei", lpk1.id, "LPK_SENSEI");
    await sees("lpk2", lpk2.id, "LPK_ADMIN");
    await sees("lpk-null", lpk1.id, null);

    // TSK A tidak bisa mengubah / memalsukan keputusan & catatan TSK B
    await actAs(tx, tsk.id, "TSK_ADMIN");
    iso.aUpdatesB = (await rowsOf(tx, (t) => t.update(candidateSelections).set({ decision: "REJECTED" }).where(eq(candidateSelections.id, selB.id)).returning({ id: candidateSelections.id }))).n;
    iso.aInsertsAsB = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: studying1.id, tskOrgId: tskB, decision: "SHORTLISTED" }));
    // Hak edit mengikuti keputusan TSK SENDIRI: TSK B punya PASSED_CLIENT_INTERVIEW, TSK A belum
    iso.aEdit = (await rowsOf(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
    iso.aEditPriv = (await rowsOf(tx, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, ready1.id)).returning({ id: candidatePrivate.candidateId }))).n;
    await actAs(tx, tskB, "TSK_STAFF");
    iso.bEdit = (await rowsOf(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
    iso.bEditPriv = (await rowsOf(tx, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, ready1.id)).returning({ id: candidatePrivate.candidateId }))).n;
    iso.bReadsA = (await tx.select().from(candidateSelections).where(eq(candidateSelections.id, selA.id))).length;

    // LPK tidak bisa menulis keputusan maupun catatan
    for (const role of ["LPK_ADMIN", "LPK_SENSEI"]) {
      await actAs(tx, lpk1.id, role);
      iso[`${role}-insert`] = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: studying1.id, tskOrgId: tsk.id, decision: "SHORTLISTED" }));
      iso[`${role}-update`] = (await rowsOf(tx, (t) => t.update(candidateSelections).set({ decision: "REJECTED" }).where(eq(candidateSelections.id, selA.id)).returning({ id: candidateSelections.id }))).n;
      iso[`${role}-delete`] = await attempt(tx, (t) => t.delete(candidateSelections).where(eq(candidateSelections.id, selA.id)));
    }

    // Kemitraan TSK A dihentikan: keputusan hilang dari pandangannya, tidak bisa menulis/mengedit
    await actAsSystem(tx);
    await tx.update(partnerships).set({ active: false }).where(and(eq(partnerships.lpkId, lpk1.id), eq(partnerships.tskId, tsk.id)));
    await decide(tx, ready1.id, tsk.id, "PASSED_CLIENT_INTERVIEW");
    await actAs(tx, tsk.id, "TSK_ADMIN");
    // (TSK A masih bermitra dengan LPK Surabaya, jadi hanya hitung keputusan atas kandidat LPK Bandung)
    const lpk1Ids = all.filter((c) => c.organizationId === lpk1.id).map((c) => c.id);
    iso.inactiveSees = (await tx.select().from(candidateSelections)).filter((s) => lpk1Ids.includes(s.candidateId)).length;
    iso.stillSeesLpk2 = (await tx.select().from(candidateSelections)).some((s) => !lpk1Ids.includes(s.candidateId));
    iso.inactiveInsert = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: studying1.id, tskOrgId: tsk.id, decision: "SHORTLISTED" }));
    iso.inactiveEdit = (await rowsOf(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
  });
  const A = iso.A as { sel: string[] };
  const B = iso.B as { sel: string[] };
  const LA = iso["lpk-admin"] as { sel: string[] };
  const LS = iso["lpk-sensei"] as { sel: string[] };
  check(
    "TSK A hanya melihat keputusan miliknya; TSK B hanya miliknya",
    JSON.stringify(A) === JSON.stringify({ sel: ["A:SHORTLISTED"] }) &&
      JSON.stringify(B) === JSON.stringify({ sel: ["B:PASSED_CLIENT_INTERVIEW"] }) && iso.bReadsA === 0,
    `A: ${A.sel} | B: ${B.sel}`,
  );
  check(
    "TSK A tidak bisa mengubah keputusan TSK B atau menulis keputusan atas nama TSK B",
    iso.aUpdatesB === 0 && typeof iso.aInsertsAsB === "string" && /row-level security/.test(iso.aInsertsAsB),
  );
  check(
    "Hak edit mengikuti keputusan TSK SENDIRI: TSK B (PASSED_CLIENT_INTERVIEW) bisa mengedit, TSK A (SHORTLISTED) tidak",
    iso.aEdit === 0 && iso.aEditPriv === 0 && iso.bEdit === 1 && iso.bEditPriv === 1,
    `A: ${iso.aEdit}/${iso.aEditPriv}, B: ${iso.bEdit}/${iso.bEditPriv}`,
  );
  check(
    "LPK (admin & sensei) membaca keputusan SEMUA TSK mitranya",
    JSON.stringify(LA) === JSON.stringify({ sel: ["A:SHORTLISTED", "B:PASSED_CLIENT_INTERVIEW"] }) &&
      JSON.stringify(LS) === JSON.stringify({ sel: ["A:SHORTLISTED", "B:PASSED_CLIENT_INTERVIEW"] }),
    `admin: ${LA.sel}`,
  );
  check(
    "LPK lain dan peran null tidak melihat keputusan",
    JSON.stringify(iso.lpk2) === JSON.stringify({ sel: [] }) && JSON.stringify(iso["lpk-null"]) === JSON.stringify({ sel: [] }),
  );
  check(
    "LPK tidak bisa menulis candidate_selections (insert ditolak, update 0 baris, delete ditolak)",
    ["LPK_ADMIN", "LPK_SENSEI"].every(
      (r) =>
        typeof iso[`${r}-insert`] === "string" && /row-level security/.test(iso[`${r}-insert`] as string) &&
        iso[`${r}-update`] === 0 &&
        typeof iso[`${r}-delete`] === "string" && /permission denied/.test(iso[`${r}-delete`] as string),
    ),
  );
  check(
    "Kemitraan TSK dihentikan: keputusan tidak terlihat, tidak bisa menulis keputusan atau mengedit walau keputusannya PASSED_CLIENT_INTERVIEW",
    iso.inactiveSees === 0 && typeof iso.inactiveInsert === "string" && iso.inactiveEdit === 0 && iso.stillSeesLpk2 === true,
    "keputusan atas kandidat LPK Surabaya (mitra yang masih aktif) tetap terlihat",
  );

  // --- E2. Catatan TSK (candidate_notes): TSK_ONLY vs SHARED_WITH_LPK ---
  const nt: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const mk = async (tskOrgId: string, body: string, visibility?: "TSK_ONLY" | "SHARED_WITH_LPK") =>
      (await tx.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId, authorId: tskAdminUser.id, body, visibility }).returning())[0];
    const onlyA = await mk(tsk.id, "rahasia A"); // visibility tidak diisi -> default
    nt.defaultVisibility = onlyA.visibility;
    const sharedA = await mk(tsk.id, "dibagikan A", "SHARED_WITH_LPK");
    const sharedB = await mk(tskB, "dibagikan B", "SHARED_WITH_LPK");
    await mk(tskB, "rahasia B", "TSK_ONLY");
    const bodies = async (label: string, orgId: string, role: string | null) => {
      await actAs(tx, orgId, role);
      nt[label] = (await tx.select().from(candidateNotes)).filter((n) => n.candidateId === ready1.id).map((n) => n.body).sort();
    };
    const readAll = async () => {
      await bodies("A-admin", tsk.id, "TSK_ADMIN");
      await bodies("A-staff", tsk.id, "TSK_STAFF");
      await bodies("B", tskB, "TSK_ADMIN");
      await bodies("lpk-admin", lpk1.id, "LPK_ADMIN");
      await bodies("lpk-sensei", lpk1.id, "LPK_SENSEI");
      await bodies("lpk-null", lpk1.id, null);
      await bodies("lpk2", lpk2.id, "LPK_ADMIN");
      await bodies("lpk3", lpk3.id, "LPK_ADMIN");
    };
    await readAll();

    // TSK (rekan satu organisasi) mengubah SHARED -> TSK_ONLY: LPK tidak bisa membacanya lagi
    await actAs(tx, tsk.id, "TSK_STAFF");
    nt.hide = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ visibility: "TSK_ONLY" }).where(eq(candidateNotes.id, sharedA.id)).returning({ id: candidateNotes.id }))).n;
    nt.hideEdit = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ body: "dibagikan A (revisi)" }).where(eq(candidateNotes.id, sharedA.id)).returning({ id: candidateNotes.id }))).n;
    await bodies("lpk-admin-after-hide", lpk1.id, "LPK_ADMIN");
    await actAs(tx, tsk.id, "TSK_ADMIN");
    nt.share = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ visibility: "SHARED_WITH_LPK" }).where(eq(candidateNotes.id, sharedA.id)).returning({ id: candidateNotes.id }))).n;
    await bodies("lpk-admin-after-share", lpk1.id, "LPK_ADMIN");

    // Perubahan visibility dicatat di audit_logs (dari, ke, siapa) di log LPK pemilik kandidat
    await actAs(tx, tsk.id, "TSK_ADMIN");
    nt.auditInsert = await attempt(tx, (t) =>
      t.insert(auditLogs).values({
        organizationId: lpk1.id, actorOrgId: tsk.id, candidateId: ready1.id, actorUserId: tskAdminUser.id,
        action: "note.visibility_change", entity: "candidate_note", entityId: sharedA.id,
        before: { visibility: "SHARED_WITH_LPK" }, after: { visibility: "TSK_ONLY" },
      }),
    );
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    const seenAudit = (await tx.select().from(auditLogs).where(eq(auditLogs.entityId, sharedA.id)))[0];
    nt.auditSeen = seenAudit ? `${JSON.stringify(seenAudit.before)}->${JSON.stringify(seenAudit.after)} oleh ${seenAudit.actorUserId === tskAdminUser.id ? "TSK" : "?"}` : null;

    // TSK B tidak bisa menyentuh catatan TSK A, tetapi bisa menulis catatannya sendiri
    await actAs(tx, tskB, "TSK_STAFF");
    nt.bUpdatesA = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ body: "diubah B" }).where(eq(candidateNotes.id, onlyA.id)).returning({ id: candidateNotes.id }))).n;
    nt.bAsA = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, body: "titipan" }));
    nt.bOwn = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tskB, authorId: null, body: "catatan B baru" }));
    // Kunci catatan tidak bisa diubah; kandidat yang tidak terlihat tidak bisa diberi catatan; tidak ada DELETE
    await actAs(tx, tsk.id, "TSK_ADMIN");
    nt.moveCand = await attempt(tx, (t) => t.update(candidateNotes).set({ candidateId: studying1.id }).where(eq(candidateNotes.id, onlyA.id)));
    nt.moveOrg = await attempt(tx, (t) => t.update(candidateNotes).set({ tskOrgId: tskB }).where(eq(candidateNotes.id, onlyA.id)));
    nt.changeAuthor = await attempt(tx, (t) => t.update(candidateNotes).set({ authorId: null }).where(eq(candidateNotes.id, onlyA.id)));
    nt.hiddenCand = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: hidden.id, tskOrgId: tsk.id, body: "x" }));
    nt.outsiderCand = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: outsider.id, tskOrgId: tsk.id, body: "x" }));
    nt.tskDelete = await attempt(tx, (t) => t.delete(candidateNotes).where(eq(candidateNotes.id, onlyA.id)));

    // LPK tidak bisa menulis / mengubah / menghapus
    for (const role of ["LPK_ADMIN", "LPK_SENSEI"]) {
      await actAs(tx, lpk1.id, role);
      nt[`${role}-insert`] = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, body: "dari LPK", visibility: "SHARED_WITH_LPK" }));
      nt[`${role}-update`] = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ body: "diubah LPK" }).where(eq(candidateNotes.id, sharedB.id)).returning({ id: candidateNotes.id }))).n;
      nt[`${role}-visibility`] = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ visibility: "TSK_ONLY" }).where(eq(candidateNotes.id, sharedB.id)).returning({ id: candidateNotes.id }))).n;
      nt[`${role}-delete`] = await attempt(tx, (t) => t.delete(candidateNotes).where(eq(candidateNotes.id, sharedB.id)));
    }

    // Kemitraan TSK A dihentikan: catatan A ikut hilang dari LPK (catatan TSK B yang masih bermitra tetap terlihat)
    await actAsSystem(tx);
    await tx.update(partnerships).set({ active: false }).where(and(eq(partnerships.lpkId, lpk1.id), eq(partnerships.tskId, tsk.id)));
    await bodies("lpk-admin-inactive", lpk1.id, "LPK_ADMIN");
    await bodies("A-inactive", tsk.id, "TSK_ADMIN");
    await actAs(tx, tsk.id, "TSK_ADMIN");
    nt.inactiveInsert = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, body: "x" }));
    await actAsSystem(tx);
    await tx.update(partnerships).set({ active: true }).where(and(eq(partnerships.lpkId, lpk1.id), eq(partnerships.tskId, tsk.id)));

    // LPK mencabut persetujuan data: TSK tidak lagi melihat/menulis catatan atas kandidat itu
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    await tx.update(candidates).set({ dataConsentDate: null }).where(eq(candidates.id, ready1.id));
    await bodies("A-revoked", tsk.id, "TSK_ADMIN");
    await actAs(tx, tsk.id, "TSK_ADMIN");
    nt.revokedInsert = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, body: "x" }));
  });
  const both = ["dibagikan A", "rahasia A"];
  check(
    "Catatan baru tanpa visibility eksplisit = TSK_ONLY (default)",
    nt.defaultVisibility === "TSK_ONLY",
  );
  check(
    "TSK membaca semua catatan organisasinya (juga milik rekan, admin & staf); TSK lain hanya catatannya sendiri",
    JSON.stringify(nt["A-admin"]) === JSON.stringify(both) && JSON.stringify(nt["A-staff"]) === JSON.stringify(both) &&
      JSON.stringify(nt.B) === JSON.stringify(["dibagikan B", "rahasia B"]),
    `A: ${nt["A-admin"]} | B: ${nt.B}`,
  );
  check(
    "Catatan TSK_ONLY tidak terbaca LPK_ADMIN maupun LPK_SENSEI (hanya SHARED yang terbaca LPK_ADMIN)",
    !(nt["lpk-admin"] as string[]).some((b) => b.startsWith("rahasia")) &&
      JSON.stringify(nt["lpk-admin"]) === JSON.stringify(["dibagikan A", "dibagikan B"]) &&
      JSON.stringify(nt["lpk-sensei"]) === JSON.stringify([]) && JSON.stringify(nt["lpk-null"]) === JSON.stringify([]),
    `LPK_ADMIN: ${nt["lpk-admin"]} | sensei: ${(nt["lpk-sensei"] as string[]).length} catatan`,
  );
  check(
    "Catatan SHARED_WITH_LPK tidak terbaca LPK lain yang bukan pemilik kandidat, maupun TSK lain",
    JSON.stringify(nt.lpk2) === JSON.stringify([]) && JSON.stringify(nt.lpk3) === JSON.stringify([]) &&
      !(nt.B as string[]).includes("dibagikan A") && !(nt["A-admin"] as string[]).includes("dibagikan B"),
  );
  check(
    "TSK mengubah SHARED_WITH_LPK -> TSK_ONLY: LPK tidak bisa membacanya lagi; dibagikan lagi: terbaca lagi",
    nt.hide === 1 && nt.hideEdit === 1 && nt.share === 1 &&
      JSON.stringify(nt["lpk-admin-after-hide"]) === JSON.stringify(["dibagikan B"]) &&
      JSON.stringify(nt["lpk-admin-after-share"]) === JSON.stringify(["dibagikan A (revisi)", "dibagikan B"]),
    `setelah disembunyikan: ${nt["lpk-admin-after-hide"]}`,
  );
  check(
    "Perubahan visibility bisa dicatat TSK di audit_logs LPK pemilik (dari, ke, siapa) dan terbaca LPK",
    nt.auditInsert === null && nt.auditSeen === '{"visibility":"SHARED_WITH_LPK"}->{"visibility":"TSK_ONLY"} oleh TSK',
    String(nt.auditSeen),
  );
  check(
    "LPK (admin & sensei) ditolak INSERT, UPDATE (isi maupun visibility), dan DELETE pada candidate_notes",
    ["LPK_ADMIN", "LPK_SENSEI"].every(
      (r) =>
        typeof nt[`${r}-insert`] === "string" && /row-level security/.test(nt[`${r}-insert`] as string) &&
        nt[`${r}-update`] === 0 && nt[`${r}-visibility`] === 0 &&
        typeof nt[`${r}-delete`] === "string" && /permission denied/.test(nt[`${r}-delete`] as string),
    ),
  );
  check(
    "TSK B tidak bisa mengubah catatan TSK A atau menulis atas nama TSK A; catatannya sendiri bisa ditulis",
    nt.bUpdatesA === 0 && typeof nt.bAsA === "string" && /row-level security/.test(nt.bAsA) && nt.bOwn === null,
  );
  check(
    "Kandidat/TSK/penulis catatan tidak bisa diganti; tidak ada DELETE untuk TSK; kandidat tak terlihat tidak bisa diberi catatan",
    [nt.moveCand, nt.moveOrg, nt.changeAuthor].every((e) => typeof e === "string" && /tidak bisa diubah/.test(e)) &&
      typeof nt.tskDelete === "string" && /permission denied/.test(nt.tskDelete) &&
      [nt.hiddenCand, nt.outsiderCand].every((e) => typeof e === "string" && /row-level security/.test(e)),
  );
  check(
    "Kemitraan dinonaktifkan: catatan TSK itu hilang dari LPK (catatan TSK mitra aktif tetap), dan TSK-nya tidak bisa membaca/menulis",
    JSON.stringify(nt["lpk-admin-inactive"]) === JSON.stringify(["dibagikan B"]) &&
      (nt["A-inactive"] as string[]).length === 0 && typeof nt.inactiveInsert === "string",
    `LPK melihat: ${nt["lpk-admin-inactive"]}`,
  );
  check(
    "Persetujuan data dicabut: TSK tidak lagi melihat maupun menulis catatan atas kandidat itu",
    (nt["A-revoked"] as string[]).length === 0 && typeof nt.revokedInsert === "string",
  );

  // --- F. Audit: pelaku tercatat (actor_org_id); LPK melihat aksi TSK atas kandidatnya ---
  const aud: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const row = (over: Partial<typeof auditLogs.$inferInsert>) => ({
      organizationId: lpk1.id,
      actorOrgId: tsk.id,
      candidateId: ready1.id,
      actorUserId: tskAdminUser.id,
      action: "candidate.update",
      entity: "candidate",
      entityId: ready1.id,
      before: { hobby: "a" },
      after: { hobby: "b" },
      ...over,
    });
    await actAs(tx, tsk.id, "TSK_ADMIN");
    aud.ok = await attempt(tx, (t) => t.insert(auditLogs).values(row({ action: "document.download" })));
    aud.own = await attempt(tx, (t) => t.insert(auditLogs).values(row({ organizationId: tsk.id, actorOrgId: tsk.id, candidateId: undefined, action: "auth.login", entity: "user", entityId: tskAdminUser.id })));
    aud.spoofActor = await attempt(tx, (t) => t.insert(auditLogs).values(row({ actorOrgId: lpk1.id })));
    aud.noActor = await attempt(tx, (t) => t.insert(auditLogs).values(row({ actorOrgId: null })));
    aud.noCandidate = await attempt(tx, (t) => t.insert(auditLogs).values(row({ candidateId: undefined })));
    aud.wrongOrg = await attempt(tx, (t) => t.insert(auditLogs).values(row({ organizationId: lpk2.id })));
    aud.hiddenCand = await attempt(tx, (t) => t.insert(auditLogs).values(row({ candidateId: hidden.id })));
    aud.outsiderCand = await attempt(tx, (t) => t.insert(auditLogs).values(row({ organizationId: lpk3.id, candidateId: outsider.id })));
    const readCount = async (orgId: string, role: string) => {
      await actAs(tx, orgId, role);
      return (await tx.select().from(auditLogs).where(eq(auditLogs.entityId, ready1.id))).filter((r) => r.actorOrgId === tsk.id).length;
    };
    aud.lpkSees = await readCount(lpk1.id, "LPK_ADMIN");
    aud.tskSees = await readCount(tsk.id, "TSK_ADMIN");
    aud.tskBSees = await readCount(tskB, "TSK_ADMIN");
    aud.lpk2Sees = await readCount(lpk2.id, "LPK_ADMIN");
  });
  check(
    "Audit: TSK mencatat aksinya atas kandidat mitra di log LPK pemilik, dengan actor_org_id = TSK-nya",
    aud.ok === null && aud.own === null,
    typeof aud.ok === "string" ? aud.ok : "",
  );
  check(
    "Audit: tidak bisa memalsukan pelaku, mengosongkan actor_org_id, atau menulis ke log organisasi/kandidat yang tidak terlihat",
    [aud.spoofActor, aud.noActor, aud.noCandidate, aud.wrongOrg, aud.hiddenCand, aud.outsiderCand].every(
      (e) => typeof e === "string" && /row-level security/.test(e),
    ),
    Object.entries(aud).filter(([, v]) => v === null).map(([k]) => k).join(","),
  );
  check(
    "Audit: LPK pemilik dan TSK pelaku melihat aksi itu; TSK lain dan LPK lain tidak",
    aud.lpkSees === 1 && aud.tskSees === 1 && aud.tskBSees === 0 && aud.lpk2Sees === 0,
    `LPK ${aud.lpkSees}, TSK ${aud.tskSees}, TSK lain ${aud.tskBSees}, LPK lain ${aud.lpk2Sees}`,
  );

  // --- G. Hal lain yang tetap: tambah/hapus kandidat, pindah LPK, pindah dokumen, batas dokumen ---
  const senseiInsertErr = await inRollback(() =>
    withTenant(lpk1.id, "LPK_SENSEI", (tx) => tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Dari Sensei" }), db),
  );
  check("Sensei: tidak bisa menambah kandidat", senseiInsertErr !== null && /row-level security/i.test(senseiInsertErr), senseiInsertErr ?? "");
  const tskInsertErr = await inRollback(() =>
    withTenant(tsk.id, "TSK_ADMIN", (tx) => tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Dari TSK" }), db),
  );
  check("TSK: tidak bisa menambah kandidat", tskInsertErr !== null && /row-level security/i.test(tskInsertErr), tskInsertErr ?? "");
  const escapes: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    await decide(tx, ready1.id, tsk.id, "DEPARTED"); // TSK punya hak edit penuh
    await tx.insert(candidateDocuments).values(sampleDoc(ready1.id));
    const otherLpk1 = all.find((c) => c.organizationId === lpk1.id && c.id !== ready1.id)!;
    await actAs(tx, tsk.id, "TSK_ADMIN");
    escapes.tskDeleteCand = (await rowsOf(tx, (t) => t.delete(candidates).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
    escapes.toLpk2 = await attempt(tx, (t) => t.update(candidates).set({ organizationId: lpk2.id }).where(eq(candidates.id, ready1.id)));
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    escapes.docMove = await attempt(tx, (t) => t.update(candidateDocuments).set({ candidateId: otherLpk1.id }).where(eq(candidateDocuments.candidateId, ready1.id)));
  });
  check("TSK (walau punya hak edit): tidak bisa menghapus kandidat", escapes.tskDeleteCand === 0);
  check("TSK: tidak bisa memindahkan kandidat ke LPK mitra lain", typeof escapes.toLpk2 === "string" && /dipindahkan|row-level security/.test(escapes.toLpk2), String(escapes.toLpk2 ?? ""));
  check("Dokumen tidak bisa dipindahkan ke kandidat lain", typeof escapes.docMove === "string" && /dipindahkan/.test(escapes.docMove), String(escapes.docMove ?? ""));

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

  await pool.end();
  console.log(failures === 0 ? "\nSemua pemeriksaan RLS lulus." : `\n${failures} pemeriksaan GAGAL.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exit(1);
});
