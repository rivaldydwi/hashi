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

import { effectiveResponsible } from "../src/db/responsibility";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { assertTestDatabase } from "./db-guard";
import { createDb, withSystem, withTenant, type Tx } from "../src/db";
import { platformOverview } from "../src/db/queries";
import { todayInAppTz } from "../src/db/time";
import { assessmentAuditEntry, noteAuditEntry } from "../src/db/audit-entries";
import {
  auditLogs,
  candidateAssessments,
  candidateCertificates,
  candidateDocuments,
  candidateHeadlineDecision,
  candidateEducations,
  candidateFamilyMembers,
  candidatePrivate,
  candidates,
  candidateNotes,
  candidateSelections,
  candidateStage,
  candidateWorkHistories,
  clientCompanies,
  clientSiteContacts,
  clientSiteFields,
  clientSites,
  jobOrders,
  organizations,
  partnerships,
  placements,
  selectionDecision,
  skillFields,
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
async function actAs(tx: Tx, orgId: string, role: string | null, userId: string | null = null) {
  await tx.execute(
    sql`select set_config('app.org_id', ${orgId}, true), set_config('app.role', ${role ?? ""}, true), set_config('app.user_id', ${userId ?? ""}, true), set_config('app.bypass_rls', 'off', true)`,
  );
}
async function actAsSystem(tx: Tx) {
  await tx.execute(
    sql`select set_config('app.org_id', '', true), set_config('app.role', '', true), set_config('app.user_id', '', true), set_config('app.bypass_rls', 'on', true)`,
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
    sql`select set_config('app.org_id', '', true), set_config('app.role', ${role}, true), set_config('app.user_id', '', true), set_config('app.bypass_rls', 'on', true)`,
  );
}

async function main() {
  // Pemeriksaan bergantung pada isi seed (mis. 23 dari 24 kandidat terlihat oleh TSK demo), jadi hanya
  // untuk database dev/test. Di produksi hasilnya gagal atau menyesatkan.
  assertTestDatabase(
    "test:rls",
    "Alasan: pemeriksaan test:rls bergantung pada isi seed, yang tidak ada di produksi.\n" +
      "  Jalankan terhadap db-dev lewat image tools: perintah lengkap ada di README.md, bagian \"Pengujian\".",
  );
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum di-set");
  const { db, pool } = createDb(url, 2);
  // Koneksi OWNER hanya dipakai sandbox() untuk mengosongkan turunan kandidat (hashi_app tidak punya DELETE di sebagian tabel,
  // dan seed demo kini lengkap); setelah itu sandbox kembali ke role hashi_app (SET LOCAL ROLE) sehingga yang diuji tetap hak aplikasi.
  const ownerUrl = process.env.MIGRATE_DATABASE_URL;
  if (!ownerUrl) throw new Error("MIGRATE_DATABASE_URL belum di-set");
  const { db: ownerDb, pool: ownerPool } = createDb(ownerUrl, 1);

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
  // TSK melihat SEMUA status dari LPK mitra, tetapi hanya yang DIBAGIKAN (shared_with_tsk). Tanggal formulir bukan gerbang.
  const isPartner = (c: { organizationId: string }) => c.organizationId === lpk1.id || c.organizationId === lpk2.id;
  const tskVisible = all.filter((c) => isPartner(c) && c.sharedWithTsk);
  const tskExpected = tskVisible.length;
  const unshared = all.filter((c) => isPartner(c) && !c.sharedWithTsk); // dari LPK mitra, belum dibagikan ke TSK
  const seededSelections = await withSystem((tx) => tx.select().from(candidateSelections), db);

  // 1. Tanpa konteks: tidak melihat apa pun
  const noCtx = await db.transaction(async (tx) => ({
    c: (await tx.select().from(candidates)).length,
    u: (await tx.select().from(users)).length,
  }));
  check("Tanpa konteks organisasi: 0 kandidat, 0 pengguna", noCtx.c === 0 && noCtx.u === 0, `${noCtx.c}/${noCtx.u}`);

  // 2. LPK hanya melihat kandidat sendiri
  for (const lpk of [lpk1, lpk2, lpk3]) {
    const rows = await withTenant({ orgId: lpk.id, role: "LPK_ADMIN" }, (tx) => tx.select().from(candidates), db);
    const onlyOwn = rows.every((r) => r.organizationId === lpk.id);
    check(
      `${lpk.name}: hanya melihat ${ownCount(lpk.id)} kandidat sendiri`,
      onlyOwn && rows.length === ownCount(lpk.id),
      `terlihat ${rows.length}`,
    );
  }

  // 3. TSK melihat kandidat LPK mitra di semua tahap (asal ada persetujuan), bukan LPK non-mitra
  const tskRows = await withTenant({ orgId: tsk.id, role: "TSK_ADMIN" }, (tx) => tx.select().from(candidates), db);
  check("TSK: jumlah kandidat mitra sesuai aturan", tskRows.length === tskExpected, `${tskRows.length}/${tskExpected}`);
  const studyingSeen = tskRows.filter((r) => r.stage === "STUDYING").length;
  const studyingExpected = tskVisible.filter((c) => c.stage === "STUDYING").length;
  check(
    "TSK: melihat kandidat STUDYING yang dibagikan",
    studyingSeen > 0 && studyingSeen === studyingExpected,
    `${studyingSeen}/${studyingExpected}`,
  );
  check(
    "TSK: melihat kandidat WITHDRAWN yang dibagikan",
    tskRows.filter((r) => r.stage === "WITHDRAWN").length === tskVisible.filter((c) => c.stage === "WITHDRAWN").length &&
      tskRows.some((r) => r.stage === "WITHDRAWN"),
  );
  check(
    "TSK: tidak melihat kandidat yang belum dibagikan (minimal 1 per LPK mitra); tanggal formulir bukan gerbang",
    unshared.length >= 3 &&
      [lpk1.id, lpk2.id].every((o) => unshared.some((c) => c.organizationId === o)) &&
      unshared.every((c) => !tskRows.some((r) => r.id === c.id)) &&
      tskRows.every((r) => r.sharedWithTsk) &&
      // dibagikan TANPA tanggal formulir -> tetap terlihat; belum dibagikan DENGAN tanggal formulir -> tidak terlihat
      all.some((c) => isPartner(c) && c.sharedWithTsk && c.dataConsentDate === null && tskRows.some((r) => r.id === c.id)) &&
      unshared.some((c) => c.dataConsentDate !== null),
    `belum dibagikan: ${unshared.map((c) => c.fullName).join(", ")}`,
  );
  check("TSK: tidak ada kandidat LPK non-mitra", tskRows.every((r) => r.organizationId !== lpk3.id));

  // 4. TSK tidak bisa mengubah isi data kandidat yang keputusannya belum PASSED_CLIENT_INTERVIEW dst.
  //    (pemeriksaan lengkap per keputusan ada di bagian "Profil kandidat" di bawah)
  const decisionOf = (id: string) => seededSelections.find((s) => s.candidateId === id)?.decision;
  const target = tskRows.find((r) => r.stage === "READY" && !["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"].includes(decisionOf(r.id) ?? "NONE"))!;
  const updated = await withTenant({ orgId: tsk.id, role: "TSK_ADMIN" },
    (tx) => tx.update(candidates).set({ fullName: "DIUBAH TSK" }).where(eq(candidates.id, target.id)).returning(),
    db,
  );
  check("TSK: tidak bisa mengubah nama kandidat yang belum diputuskan", updated.length === 0);

  // 5. LPK tidak bisa membuat kandidat atas nama organisasi lain
  const insertErr = await expectError(() =>
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, (tx) => tx.insert(candidates).values({ organizationId: lpk2.id, fullName: "Titipan" }), db),
  );
  check("LPK: tidak bisa menulis kandidat ke LPK lain", insertErr !== null && /row-level security/i.test(insertErr));

  // 6. LPK tidak bisa memindahkan kandidatnya ke LPK lain
  const own = all.find((c) => c.organizationId === lpk1.id)!;
  const moveErr = await expectError(() =>
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, (tx) => tx.update(candidates).set({ organizationId: lpk2.id }).where(eq(candidates.id, own.id)), db),
  );
  check(
    "LPK: tidak bisa memindahkan kandidat ke LPK lain",
    moveErr !== null && /row-level security|tidak bisa dipindahkan/i.test(moveErr),
    moveErr ?? "",
  );

  // 7. Pengguna organisasi lain tidak terlihat
  const tskUsers = await withTenant({ orgId: tsk.id, role: "TSK_ADMIN" }, (tx) => tx.select().from(users), db);
  check("TSK: hanya melihat pengguna TSK sendiri", tskUsers.length > 0 && tskUsers.every((u) => u.organizationId === tsk.id));

  // 8. Organisasi: sendiri + mitra saja
  const lpk3Orgs = await withTenant({ orgId: lpk3.id, role: "LPK_ADMIN" }, (tx) => tx.select().from(organizations), db);
  check("LPK non-mitra: hanya melihat organisasinya sendiri", lpk3Orgs.length === 1 && lpk3Orgs[0].id === lpk3.id);
  const tskOrgs = await withTenant({ orgId: tsk.id, role: "TSK_ADMIN" }, (tx) => tx.select().from(organizations).where(ne(organizations.id, tsk.id)), db);
  check(
    "TSK: melihat 2 LPK mitra, bukan LPK non-mitra",
    tskOrgs.length === 2 && tskOrgs.every((o) => o.id !== lpk3.id),
    tskOrgs.map((o) => o.name).join(", "),
  );

  // 9. Kemitraan hanya bisa diubah oleh sistem
  const partnerErr = await expectError(() =>
    withTenant({ orgId: lpk3.id, role: "LPK_ADMIN" }, (tx) => tx.insert(partnerships).values({ lpkId: lpk3.id, tskId: tsk.id }), db),
  );
  check("LPK: tidak bisa membuat kemitraan sendiri", partnerErr !== null);

  // 10. Audit log append-only
  const auditDelErr = await expectError(() =>
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, (tx) => tx.delete(auditLogs).where(and(eq(auditLogs.organizationId, lpk1.id))), db),
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
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, async (tx) => {
      await tx.insert(users).values(tempUser(lpk1.id, "LPK_SENSEI"));
      throw new Rollback();
    }, db),
  );
  check("LPK: bisa menambah sensei di organisasi sendiri", addSenseiErr === null, addSenseiErr ?? "");

  // 13-14. Peran harus sesuai jenis organisasi (mencegah eskalasi hak akses)
  const escalateErr = await inRollback(() =>
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, (tx) => tx.insert(users).values(tempUser(lpk1.id, "SUPER_ADMIN")), db),
  );
  check("LPK: tidak bisa membuat SUPER_ADMIN", escalateErr !== null && /tidak diizinkan/.test(escalateErr));
  const promoteErr = await inRollback(() =>
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, (tx) => tx.update(users).set({ role: "TSK_STAFF" }).where(eq(users.organizationId, lpk1.id)), db),
  );
  check("LPK: tidak bisa memberi peran TSK ke pengguna LPK", promoteErr !== null && /tidak diizinkan/.test(promoteErr));

  // 15. Pengguna tidak bisa dipindah ke organisasi lain
  const moveUserErr = await inRollback(() =>
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, (tx) => tx.update(users).set({ organizationId: lpk2.id }).where(eq(users.organizationId, lpk1.id)), db),
  );
  check("LPK: tidak bisa memindahkan pengguna ke organisasi lain", moveUserErr !== null);

  // 16. Organisasi hanya bisa diubah oleh sistem (super admin)
  const renamed = await withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" },
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
    withTenant({ orgId: lpk1.id, role: "LPK_ADMIN" }, (tx) => tx.insert(users).values({ ...tempUser(lpk1.id, "LPK_SENSEI"), email: "Besar@Hashi.test" }), db),
  );
  check("Email dengan huruf besar ditolak database", upperErr !== null);

  // ==========================================================================
  // Profil kandidat: status LPK (stage) vs keputusan TSK (candidate_selections)
  // ==========================================================================
  const EDIT_DECISIONS = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"]; // sengaja ditulis eksplisit
  const consented = (c: (typeof all)[number]) => c.sharedWithTsk; // 'terlihat oleh TSK'
  // Seed demo kini lengkap (semua kandidat punya data sensitif, dokumen, penilaian, dan sebagian keputusan). Kandidat uji
  // dipilih dari yang terlihat TSK; `sandbox()` mengosongkan turunannya (di dalam transaksi yang selalu di-rollback)
  // supaya tiap tes mulai dari kandidat "bersih".
  // Kandidat dengan keputusan seed yang membuka hak edit TSK dilewati: himpunan "bisa diedit TSK" dihitung dari seed dan tidak boleh berubah.
  const editableSeed = (id: string) => seededSelections.some((s) => s.candidateId === id && EDIT_DECISIONS.includes(s.decision));
  const pick = (org: string, stage: string) =>
    all.find((c) => c.organizationId === org && c.stage === stage && consented(c) && !editableSeed(c.id) && c.dataConsentDate !== null)!; // tanggal formulir terisi: tes "ubah ke null" harus benar-benar mengubah
  const ready1 = pick(lpk1.id, "READY");
  const studying1 = pick(lpk1.id, "STUDYING");
  const withdrawn1 = pick(lpk1.id, "WITHDRAWN");
  const outsider = pick(lpk3.id, "READY");
  const hidden = unshared.find((c) => c.organizationId === lpk1.id && c.stage === "READY")!; // LPK Bandung, READY, belum dibagikan
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
    const err = await errorMessage(() =>
      withSystem(async (tx) => {
        await clearCleanTargets(tx); // sebagai owner
        await tx.execute(sql`set local role hashi_app`); // selanjutnya: hak aplikasi, sama seperti produksi
        await fn(tx);
        throw new Rollback();
      }, ownerDb),
    );
    if (err) throw new Error(`sandbox gagal (kesalahan di dalam tes, bukan hasil pemeriksaan): ${err}`);
  }
  /**
   * Kosongkan data turunan SEMUA kandidat (kecuali keputusan TSK, yang hanya dikosongkan untuk kandidat uji). Hanya di dalam
   * sandbox, yang selalu di-rollback. Seed demo lengkap, sedangkan tes menghitung baris yang ia sisipkan sendiri.
   */
  async function clearCleanTargets(tx: Tx) {
    const ids = [ready1, studying1, withdrawn1, outsider, hidden].map((c) => c.id);
    await tx.delete(candidateSelections).where(inArray(candidateSelections.candidateId, ids));
    for (const t of [candidateDocuments, candidateNotes, candidateAssessments, candidateCertificates, candidateEducations, candidateFamilyMembers, candidateWorkHistories, candidatePrivate]) {
      await tx.delete(t);
    }
  }
  /** TSK kedua (mitra LPK Bandung) untuk menguji isolasi antar-TSK. Dipanggil dalam mode sistem. */
  async function makeTskB(tx: Tx) {
    const [org] = await tx.insert(organizations).values({ name: "TSK Uji B", type: "TSK", country: "JP", defaultLocale: "ja" }).returning();
    await tx.insert(partnerships).values({ lpkId: lpk1.id, tskId: org.id });
    return org.id;
  }
  // Keputusan yang WAJIB punya job order (sama dengan CHECK candidate_selections_job_order_required; daftar eksplisit)
  const NEEDS_JOB_ORDER: readonly string[] = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"];
  /** Job order uji milik TSK tertentu (perusahaan + lokasi yang menerima bidang "food" + job order). */
  async function newJobOrder(tx: Tx, tskOrgId: string): Promise<string> {
    const [food] = await tx.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "food"));
    const [co] = await tx.insert(clientCompanies).values({ orgId: tskOrgId, name: `Uji ${uniq()}` }).returning({ id: clientCompanies.id });
    const [si] = await tx.insert(clientSites).values({ orgId: tskOrgId, companyId: co.id, name: `Lokasi ${uniq()}` }).returning({ id: clientSites.id });
    await tx.insert(clientSiteFields).values({ siteId: si.id, fieldId: food.id, orgId: tskOrgId });
    const [jo] = await tx.insert(jobOrders).values({ orgId: tskOrgId, siteId: si.id, fieldId: food.id, title: `Job order uji ${uniq()}`, positions: 50 }).returning({ id: jobOrders.id });
    return jo.id;
  }
  const selValues = async (tx: Tx, candidateId: string, tskOrgId: string, decision: (typeof selectionDecision.enumValues)[number]) => ({
    candidateId,
    tskOrgId,
    decision,
    jobOrderId: NEEDS_JOB_ORDER.includes(decision) ? await newJobOrder(tx, tskOrgId) : null,
  });
  /**
   * "Ganti keputusan" = hapus baris lama kandidat x TSK itu (dan penempatannya) sebagai owner, lalu tulis satu baris baru. (Model baru:
   * satu baris per job order, jadi upsert lama tidak cukup; hapus dilakukan lewat RESET ROLE karena hashi_app tidak punya DELETE.)
   */
  const decide = async (tx: Tx, candidateId: string, tskOrgId: string, decision: (typeof selectionDecision.enumValues)[number]) => {
    await tx.execute(sql`reset role`);
    await tx.execute(sql`delete from placements where candidate_id = ${candidateId}`);
    await tx.execute(sql`delete from candidate_selections where candidate_id = ${candidateId} and tsk_org_id = ${tskOrgId}`);
    await tx.execute(sql`set local role hashi_app`);
    return tx.insert(candidateSelections).values(await selValues(tx, candidateId, tskOrgId, decision)).returning();
  };

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
      const allowed = EDIT_DECISIONS.includes(d) && s !== "WITHDRAWN";
      return opsOf(allowed, allowed); // dokumen boleh dihapus TSK hanya bila boleh mengedit
    });
    check(
      `${role}: hak edit + unggah/hapus DOKUMEN = keputusan IN (${EDIT_DECISIONS.join(", ")}) dan LPK belum WITHDRAWN`,
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
        ["STUDYING", "READY"].every((s) => JSON.stringify(ops[`${s}/${d}/${role}`]) === JSON.stringify(opsOf(true, true))),
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
    stg.shareTsk = await attempt(tx, (t) => t.update(candidates).set({ sharedWithTsk: false }).where(eq(candidates.id, ready1.id)));
    stg.shareAtTsk = await attempt(tx, (t) => t.update(candidates).set({ sharedWithTskAt: new Date(0) }).where(eq(candidates.id, ready1.id)));
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
    await tx.update(candidates).set({ sharedWithTsk: false }).where(eq(candidates.id, ready1.id));
    await actAs(tx, tsk.id, "TSK_ADMIN");
    stg.revokedCand = (await tx.select().from(candidates).where(eq(candidates.id, ready1.id))).length;
    stg.revokedSel = (await tx.select().from(candidateSelections).where(eq(candidateSelections.candidateId, ready1.id))).length;
    stg.revokedEdit = (await rowsOf(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
  });
  check(
    "TSK tidak bisa mengubah candidates.stage, tanggal formulir, maupun shared_with_tsk* (walau punya hak edit), tetapi kolom data lain bisa",
    [stg.stageTsk, stg.consentTsk, stg.consentTsk2, stg.shareTsk, stg.shareAtTsk].every((e) => typeof e === "string" && /hanya bisa diubah oleh LPK/.test(e)) && stg.hobbyTsk === null,
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

  // --- E2. Catatan TSK (candidate_notes): visibility, penulis, dan audit tanpa isi catatan ---
  const nt: Record<string, unknown> = {};
  const SECRET = "RAHASIA-wawancara-kandidat-9137"; // teks yang TIDAK boleh muncul di audit yang terbaca LPK
  const staffUser = allUsers.find((u) => u.role === "TSK_STAFF")!;
  const makeUser = async (tx: Tx, orgId: string, role: "TSK_ADMIN" | "TSK_STAFF") =>
    (await tx.insert(users).values({ organizationId: orgId, email: `uji-${uniq()}@hashi.test`, name: "Uji", role, passwordHash: "x" }).returning())[0].id;
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const staffB = await makeUser(tx, tskB, "TSK_STAFF");
    const mk = async (candidateId: string, tskOrgId: string, authorId: string, body: string, visibility?: "TSK_ONLY" | "SHARED_WITH_LPK") =>
      (await tx.insert(candidateNotes).values({ candidateId, tskOrgId, authorId, body, visibility }).returning())[0];
    const onlyA = await mk(ready1.id, tsk.id, tskAdminUser.id, "rahasia A"); // visibility tidak diisi -> default
    nt.defaultVisibility = onlyA.visibility;
    const sharedA = await mk(ready1.id, tsk.id, tskAdminUser.id, "dibagikan A", "SHARED_WITH_LPK");
    const sharedB = await mk(ready1.id, tskB, adminB, "dibagikan B", "SHARED_WITH_LPK");
    await mk(ready1.id, tskB, adminB, "rahasia B", "TSK_ONLY");
    const staffNote = await mk(studying1.id, tsk.id, staffUser.id, "catatan staf");
    const bodies = async (label: string, orgId: string, role: string | null) => {
      await actAs(tx, orgId, role);
      nt[label] = (await tx.select().from(candidateNotes)).filter((n) => n.candidateId === ready1.id).map((n) => n.body).sort();
    };
    await bodies("A-admin", tsk.id, "TSK_ADMIN");
    await bodies("A-staff", tsk.id, "TSK_STAFF");
    await bodies("B", tskB, "TSK_ADMIN");
    await bodies("lpk-admin", lpk1.id, "LPK_ADMIN");
    await bodies("lpk-sensei", lpk1.id, "LPK_SENSEI");
    await bodies("lpk-null", lpk1.id, null);
    await bodies("lpk2", lpk2.id, "LPK_ADMIN");
    await bodies("lpk3", lpk3.id, "LPK_ADMIN");

    // TSK_ADMIN mengubah SHARED -> TSK_ONLY: LPK tidak bisa membacanya lagi; dibagikan lagi: terbaca lagi
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    nt.hide = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ visibility: "TSK_ONLY" }).where(eq(candidateNotes.id, sharedA.id)).returning({ id: candidateNotes.id }))).n;
    nt.hideEdit = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ body: "dibagikan A (revisi)" }).where(eq(candidateNotes.id, sharedA.id)).returning({ id: candidateNotes.id }))).n;
    await bodies("lpk-admin-after-hide", lpk1.id, "LPK_ADMIN");
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    nt.share = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ visibility: "SHARED_WITH_LPK" }).where(eq(candidateNotes.id, sharedA.id)).returning({ id: candidateNotes.id }))).n;
    await bodies("lpk-admin-after-share", lpk1.id, "LPK_ADMIN");

    // Siapa boleh MENGUBAH (isi & visibility): penulis atau TSK_ADMIN, di organisasi TSK yang sama
    const tryEdit = async (label: string, orgId: string, role: string, userId: string | null, noteId: string) => {
      await actAs(tx, orgId, role, userId);
      const body = await rowsOf(tx, (t) => t.update(candidateNotes).set({ body: uniq() }).where(eq(candidateNotes.id, noteId)).returning({ id: candidateNotes.id }));
      const vis = await rowsOf(tx, (t) => t.update(candidateNotes).set({ visibility: "SHARED_WITH_LPK" }).where(eq(candidateNotes.id, noteId)).returning({ id: candidateNotes.id }));
      nt[label] = `${body.n}/${vis.n}`;
    };
    await tryEdit("edit-staf-lain", tsk.id, "TSK_STAFF", randomUUID(), staffNote.id);
    await tryEdit("edit-staf-tanpa-user", tsk.id, "TSK_STAFF", null, staffNote.id);
    await tryEdit("edit-penulis", tsk.id, "TSK_STAFF", staffUser.id, staffNote.id);
    await tryEdit("edit-admin", tsk.id, "TSK_ADMIN", tskAdminUser.id, staffNote.id);
    await tryEdit("edit-admin-tsk-lain", tskB, "TSK_ADMIN", adminB, staffNote.id);
    await tryEdit("edit-staf-tsk-lain", tskB, "TSK_STAFF", staffB, staffNote.id);
    await tryEdit("edit-staf-catatan-admin", tsk.id, "TSK_STAFF", staffUser.id, onlyA.id);
    await tryEdit("edit-staf-catatan-admin-tsk-lain", tskB, "TSK_ADMIN", adminB, onlyA.id);

    // Membuat catatan: penulis harus user yang login
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    nt.insOwn = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, authorId: staffUser.id, body: "catatan staf baru" }));
    nt.insSpoof = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "atas nama admin" }));
    nt.insNoAuthor = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, body: "tanpa penulis" }));
    await actAs(tx, tsk.id, "TSK_STAFF", null);
    nt.insNoUser = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, authorId: staffUser.id, body: "tanpa user" }));

    // Audit catatan: hanya id catatan + visibility (dari, ke). Isi catatan TIDAK BOLEH ikut.
    await actAsSystem(tx);
    const secret = await mk(ready1.id, tsk.id, tskAdminUser.id, SECRET, "SHARED_WITH_LPK");
    const entries = [
      noteAuditEntry({ action: "note.create", note: secret, lpkOrgId: lpk1.id, actorUserId: tskAdminUser.id, to: "SHARED_WITH_LPK" }),
      noteAuditEntry({ action: "note.visibility_change", note: secret, lpkOrgId: lpk1.id, actorUserId: tskAdminUser.id, from: "SHARED_WITH_LPK", to: "TSK_ONLY" }),
      noteAuditEntry({ action: "note.update", note: secret, lpkOrgId: lpk1.id, actorUserId: tskAdminUser.id, from: "TSK_ONLY", to: "TSK_ONLY", bodyChanged: true }),
    ];
    nt.entries = entries;
    nt.secretId = secret.id;
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    nt.auditInsert = await attempt(tx, (t) => t.insert(auditLogs).values(entries));
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    const seenByLpk = await tx.select().from(auditLogs); // SEMUA baris audit yang bisa dibaca LPK
    nt.lpkAuditAll = JSON.stringify(seenByLpk);
    nt.lpkNoteAudit = seenByLpk.filter((r) => r.entity === "candidate_note" && r.entityId === secret.id).map((r) => ({ action: r.action, before: r.before, after: r.after }));

    // TSK B tidak bisa menyentuh catatan TSK A (TSK_ADMIN pun tidak), tetapi bisa menulis catatannya sendiri
    await actAs(tx, tskB, "TSK_ADMIN", adminB);
    nt.bUpdatesA = (await rowsOf(tx, (t) => t.update(candidateNotes).set({ body: "diubah B" }).where(eq(candidateNotes.id, onlyA.id)).returning({ id: candidateNotes.id }))).n;
    nt.bAsA = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, authorId: adminB, body: "titipan" }));
    nt.bOwn = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tskB, authorId: adminB, body: "catatan B baru" }));
    // Kunci catatan tidak bisa diganti; kandidat yang tidak terlihat tidak bisa diberi catatan; tidak ada DELETE
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    nt.moveCand = await attempt(tx, (t) => t.update(candidateNotes).set({ candidateId: studying1.id }).where(eq(candidateNotes.id, onlyA.id)));
    nt.moveOrg = await attempt(tx, (t) => t.update(candidateNotes).set({ tskOrgId: tskB }).where(eq(candidateNotes.id, onlyA.id)));
    nt.changeAuthor = await attempt(tx, (t) => t.update(candidateNotes).set({ authorId: staffUser.id }).where(eq(candidateNotes.id, onlyA.id)));
    nt.hiddenCand = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: hidden.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "x" }));
    nt.outsiderCand = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: outsider.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "x" }));
    nt.tskDelete = await attempt(tx, (t) => t.delete(candidateNotes).where(eq(candidateNotes.id, onlyA.id)));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    nt.staffDelete = await attempt(tx, (t) => t.delete(candidateNotes).where(eq(candidateNotes.id, staffNote.id)));

    // LPK tidak bisa menulis / mengubah / menghapus
    for (const role of ["LPK_ADMIN", "LPK_SENSEI"]) {
      await actAs(tx, lpk1.id, role, randomUUID());
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
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    nt.inactiveInsert = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "x" }));
    await actAsSystem(tx);
    await tx.update(partnerships).set({ active: true }).where(and(eq(partnerships.lpkId, lpk1.id), eq(partnerships.tskId, tsk.id)));

    // LPK mencabut persetujuan data: TSK tidak lagi melihat/menulis catatan atas kandidat itu
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    await tx.update(candidates).set({ sharedWithTsk: false }).where(eq(candidates.id, ready1.id));
    await bodies("A-revoked", tsk.id, "TSK_ADMIN");
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    nt.revokedInsert = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "x" }));
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
    "Mengubah catatan (isi & visibility): staf TSK lain DITOLAK, penulis BISA, TSK_ADMIN BISA, TSK_ADMIN dari TSK lain DITOLAK",
    nt["edit-staf-lain"] === "0/0" && nt["edit-staf-tanpa-user"] === "0/0" && nt["edit-penulis"] === "1/1" &&
      nt["edit-admin"] === "1/1" && nt["edit-admin-tsk-lain"] === "0/0" && nt["edit-staf-tsk-lain"] === "0/0",
    `staf lain ${nt["edit-staf-lain"]}, tanpa user ${nt["edit-staf-tanpa-user"]}, penulis ${nt["edit-penulis"]}, admin ${nt["edit-admin"]}, admin TSK lain ${nt["edit-admin-tsk-lain"]} (isi/visibility)`,
  );
  check(
    "Staf TSK tidak bisa mengubah catatan milik admin TSK (rekannya); admin TSK lain juga tidak",
    nt["edit-staf-catatan-admin"] === "0/0" && nt["edit-staf-catatan-admin-tsk-lain"] === "0/0",
  );
  check(
    "Membuat catatan: penulis harus user yang login (tidak bisa atas nama rekan, tanpa penulis, atau tanpa user)",
    nt.insOwn === null &&
      [nt.insSpoof, nt.insNoAuthor, nt.insNoUser].every((e) => typeof e === "string" && /row-level security/.test(e)),
    typeof nt.insOwn === "string" ? nt.insOwn : "",
  );
  // --- Audit catatan: hanya id + visibility (dari, ke); tidak pernah isi catatan ---
  const noteEntries = nt.entries as Array<{ action: string; entityId: string; before?: Record<string, unknown>; after?: Record<string, unknown> }>;
  const vc = noteEntries.find((e) => e.action === "note.visibility_change")!;
  check(
    "Baris audit note.visibility_change hanya berisi id catatan + visibility dari/ke (tanpa isi catatan)",
    JSON.stringify(Object.keys(vc.before ?? {})) === '["visibility"]' && JSON.stringify(Object.keys(vc.after ?? {})) === '["visibility"]' &&
      vc.entityId === nt.secretId && vc.before?.visibility === "SHARED_WITH_LPK" && vc.after?.visibility === "TSK_ONLY" &&
      !JSON.stringify(noteEntries).includes(SECRET),
    JSON.stringify({ before: vc.before, after: vc.after }),
  );
  check(
    "Audit catatan bisa dicatat TSK di log LPK pemilik, dan terbaca LPK (dari, ke, siapa)",
    nt.auditInsert === null &&
      (nt.lpkNoteAudit as unknown[]).length === 3 &&
      JSON.stringify((nt.lpkNoteAudit as Array<{ action: string; before: unknown; after: unknown }>).find((r) => r.action === "note.visibility_change")) ===
        '{"action":"note.visibility_change","before":{"visibility":"SHARED_WITH_LPK"},"after":{"visibility":"TSK_ONLY"}}',
    typeof nt.auditInsert === "string" ? nt.auditInsert : "",
  );
  check(
    "Isi audit log yang terbaca LPK tidak memuat teks catatan TSK_ONLY (semua baris diperiksa, termasuk note.create & note.update)",
    typeof nt.lpkAuditAll === "string" && !nt.lpkAuditAll.includes(SECRET) && !nt.lpkAuditAll.includes("RAHASIA") && !nt.lpkAuditAll.includes("rahasia A") && !nt.lpkAuditAll.includes("rahasia B"),
    `${(nt.lpkAuditAll as string).length} karakter audit diperiksa`,
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
    "TSK B (juga TSK_ADMIN-nya) tidak bisa mengubah catatan TSK A atau menulis atas nama TSK A; catatannya sendiri bisa ditulis",
    nt.bUpdatesA === 0 && typeof nt.bAsA === "string" && /row-level security/.test(nt.bAsA) && nt.bOwn === null,
  );
  check(
    "Kandidat/TSK/penulis catatan tidak bisa diganti; tidak ada DELETE (admin maupun staf); kandidat tak terlihat tidak bisa diberi catatan",
    [nt.moveCand, nt.moveOrg, nt.changeAuthor].every((e) => typeof e === "string" && /tidak bisa diubah/.test(e)) &&
      [nt.tskDelete, nt.staffDelete].every((e) => typeof e === "string" && /permission denied/.test(e)) &&
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

  // --- H. UPDATE TANPA WHERE: policy UPDATE harus berdiri sendiri ---
  // Semua tes lain memakai WHERE id = ..., sehingga policy SELECT ikut berlaku dan bisa menutupi
  // policy UPDATE yang terlalu longgar. Di sini UPDATE dijalankan tanpa WHERE (seperti bug di aplikasi),
  // lalu baris yang benar-benar berubah dihitung sebagai sistem.
  const pciLpk1 = seededSelections.find(
    (s) => s.tskOrgId === tsk.id && EDIT_DECISIONS.includes(s.decision) && all.find((c) => c.id === s.candidateId)?.organizationId === lpk1.id,
  )!.candidateId;
  const tskEditable = seededSelections
    .filter((s) => s.tskOrgId === tsk.id && EDIT_DECISIONS.includes(s.decision))
    .map((s) => all.find((c) => c.id === s.candidateId)!)
    .filter((c) => consented(c) && c.stage !== "WITHDRAWN" && isPartner(c))
    .map((c) => c.id)
    .sort();
  const lpk1Ids = all.filter((c) => c.organizationId === lpk1.id).map((c) => c.id).sort();
  const blk: Record<string, string[]> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    await decide(tx, ready1.id, tskB, "PASSED_CLIENT_INTERVIEW"); // TSK B hanya berhak mengedit ready1
    await tx.insert(candidatePrivate).values([{ candidateId: ready1.id }, { candidateId: pciLpk1 }]);
    await tx.insert(candidateDocuments).values([sampleDoc(ready1.id), sampleDoc(pciLpk1)]);
    await tx.insert(candidateFamilyMembers).values([{ candidateId: ready1.id, relation: "FATHER", name: "F1" }, { candidateId: pciLpk1, relation: "FATHER", name: "F2" }]);
    // Penilaian uji untuk probe: dikenali lewat penilainya (semua berbeda), baris bertahun 2020
    const hSensei = allUsers.find((u) => u.email === "lpk1.sensei@hashi.test")!;
    const hAdmin = allUsers.find((u) => u.role === "LPK_ADMIN" && u.organizationId === lpk1.id)!;
    await tx.insert(candidateAssessments).values([
      { candidateId: ready1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessorId: hSensei.id, assessedOn: "2020-01-05" },
      { candidateId: pciLpk1, orgId: lpk1.id, kind: "LPK_MONTHLY", assessorId: hAdmin.id, assessedOn: "2020-01-06" },
      { candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessorId: staffUser.id, assessedOn: "2020-01-07" },
      { candidateId: pciLpk1, orgId: tsk.id, kind: "TSK_VISIT", assessorId: tskAdminUser.id, assessedOn: "2020-01-08" },
      { candidateId: ready1.id, orgId: tskB, kind: "TSK_VISIT", assessorId: adminB, assessedOn: "2020-01-09" },
    ]);
    const probeAssessors = [hSensei.id, hAdmin.id, staffUser.id, tskAdminUser.id, adminB];
    blk.hSensei = [hSensei.id];
    blk.hAdmin = [hAdmin.id];
    await tx.insert(candidateNotes).values([
      { candidateId: ready1.id, tskOrgId: tskB, authorId: adminB, body: "catatan B" },
      { candidateId: ready1.id, tskOrgId: tsk.id, authorId: staffUser.id, body: "catatan staf" },
    ]);
    const who: Record<string, [string, string | null, string | null]> = {
      "TSK_ADMIN": [tsk.id, "TSK_ADMIN", tskAdminUser.id],
      "TSK_STAFF": [tsk.id, "TSK_STAFF", staffUser.id],
      "TSK_STAFF-tanpa-user": [tsk.id, "TSK_STAFF", null],
      "TSK_B": [tskB, "TSK_ADMIN", adminB],
      "LPK_ADMIN": [lpk1.id, "LPK_ADMIN", null],
      "LPK_SENSEI": [lpk1.id, "LPK_SENSEI", null],
      "LPK_NULL": [lpk1.id, null, null],
    };
    const probe = async (label: string, w: string, run: (t: Tx, m: string) => Promise<unknown>, read: (t: Tx, m: string) => Promise<string[]>) => {
      const m = `BLK-${++seq}`;
      await scratch(tx, async (sp) => {
        await actAs(sp, ...who[w]);
        await attempt(sp, (t) => run(t, m));
        await actAsSystem(sp);
        blk[`${label}/${w}`] = (await read(sp, m)).sort();
      });
    };
    for (const w of Object.keys(who)) {
      await probe("candidates", w, (t, m) => t.update(candidates).set({ hobby: m }), async (t, m) => (await t.select({ id: candidates.id }).from(candidates).where(eq(candidates.hobby, m))).map((r) => r.id));
      await probe("private", w, (t, m) => t.update(candidatePrivate).set({ phone: m }), async (t, m) => (await t.select({ id: candidatePrivate.candidateId }).from(candidatePrivate).where(eq(candidatePrivate.phone, m))).map((r) => r.id));
      await probe("docs", w, (t, m) => t.update(candidateDocuments).set({ originalFilename: m }), async (t, m) => (await t.select({ id: candidateDocuments.candidateId }).from(candidateDocuments).where(eq(candidateDocuments.originalFilename, m))).map((r) => r.id));
      // DELETE tanpa WHERE: kandidat yang baris dokumen/keluarganya HILANG
      const goneDocs = async (t: Tx) => {
        const left = new Set((await t.select({ id: candidateDocuments.candidateId }).from(candidateDocuments)).map((r) => r.id));
        return [ready1.id, pciLpk1].filter((id) => !left.has(id));
      };
      const goneFamily = async (t: Tx) => {
        const left = new Set((await t.select({ id: candidateFamilyMembers.candidateId }).from(candidateFamilyMembers)).map((r) => r.id));
        return [ready1.id, pciLpk1].filter((id) => !left.has(id));
      };
      await probe("docsDel", w, (t) => t.delete(candidateDocuments), goneDocs);
      await probe("familyDel", w, (t) => t.delete(candidateFamilyMembers), goneFamily);
      // UPDATE tanpa WHERE yang mematikan berbagi: kandidat yang JADI tidak dibagikan
      await probe("unshare", w, (t) => t.update(candidates).set({ sharedWithTsk: false }), async (t) => {
        const now = new Set((await t.select({ id: candidates.id }).from(candidates).where(eq(candidates.sharedWithTsk, true))).map((r) => r.id));
        return [ready1.id, pciLpk1].filter((id) => !now.has(id));
      });
      // Penilaian: UPDATE/DELETE tanpa WHERE, dikenali lewat penilai baris uji (bertahun 2020)
      await probe("assessUpd", w, (t, m) => t.update(candidateAssessments).set({ note: m }), async (t, m) =>
        (await t.select({ id: candidateAssessments.assessorId }).from(candidateAssessments).where(and(eq(candidateAssessments.note, m), lt(candidateAssessments.period, "2021-01-01")))).map((r) => r.id ?? "-"));
      await probe("assessDel", w, (t) => t.delete(candidateAssessments), async (t) => {
        const left = new Set((await t.select({ id: candidateAssessments.assessorId }).from(candidateAssessments).where(lt(candidateAssessments.period, "2021-01-01"))).map((r) => r.id));
        return probeAssessors.filter((id) => !left.has(id));
      });
      // Penanda perubahan = decided_at diset ke waktu yang tidak mungkin ada di seed (nilai keputusan tidak cocok: seed memakai semuanya)
      const MARK = new Date("2001-01-01T00:00:00Z");
      await probe("selections", w, (t) => t.update(candidateSelections).set({ decidedAt: MARK }), async (t) => (await t.select({ id: candidateSelections.tskOrgId }).from(candidateSelections).where(eq(candidateSelections.decidedAt, MARK))).map((r) => r.id));
      await probe("notes", w, (t, m) => t.update(candidateNotes).set({ body: m }), async (t, m) => (await t.select({ id: candidateNotes.authorId }).from(candidateNotes).where(eq(candidateNotes.body, m))).map((r) => r.id ?? "-"));
    }
    blk.tskBId = [tskB];
    blk.adminBId = [adminB];
  });
  const S = (a: string[]) => JSON.stringify([...a].sort());
  const eq2 = (label: string, w: string, expected: string[]) => S(blk[`${label}/${w}`] ?? ["(tidak diukur)"]) === S(expected);
  const none = (label: string, ws: string[]) => ws.every((w) => eq2(label, w, []));
  check(
    "UPDATE tanpa WHERE pada candidates: TSK hanya mengenai kandidat yang keputusannya membuka hak edit; TSK lain hanya miliknya; sensei/peran null tidak sama sekali",
    eq2("candidates", "TSK_ADMIN", tskEditable) && eq2("candidates", "TSK_STAFF", tskEditable) &&
      eq2("candidates", "TSK_B", [ready1.id]) && none("candidates", ["LPK_SENSEI", "LPK_NULL"]) && eq2("candidates", "LPK_ADMIN", lpk1Ids),
    `TSK menyentuh ${blk["candidates/TSK_ADMIN"]?.length}/${tskEditable.length} kandidat, LPK_ADMIN ${blk["candidates/LPK_ADMIN"]?.length}/${lpk1Ids.length}`,
  );
  check(
    "UPDATE tanpa WHERE pada candidate_private & dokumen: TSK hanya kandidat yang boleh diedit; sensei, peran null tidak sama sekali",
    ["private", "docs"].every((tb) =>
      eq2(tb, "TSK_ADMIN", [pciLpk1]) && eq2(tb, "TSK_STAFF", [pciLpk1]) && eq2(tb, "TSK_B", [ready1.id]) &&
      none(tb, ["LPK_SENSEI", "LPK_NULL"]) && eq2(tb, "LPK_ADMIN", [ready1.id, pciLpk1]),
    ),
  );
  check(
    "UPDATE tanpa WHERE yang mematikan shared_with_tsk: hanya LPK_ADMIN pemilik yang berhasil; TSK (walau berhak edit), sensei, dan peran null tidak sama sekali",
    eq2("unshare", "LPK_ADMIN", [ready1.id, pciLpk1]) && none("unshare", ["TSK_ADMIN", "TSK_STAFF", "TSK_STAFF-tanpa-user", "TSK_B", "LPK_SENSEI", "LPK_NULL"]),
    `LPK_ADMIN mengubah ${blk["unshare/LPK_ADMIN"]?.length}/2 kandidat`,
  );
  check(
    "UPDATE tanpa WHERE pada penilaian: TSK_ADMIN hanya milik TSK-nya, staf hanya yang dinilainya, TSK lain hanya miliknya; LPK_ADMIN hanya LPK_MONTHLY; sensei tanpa user dan peran null tidak sama sekali",
    eq2("assessUpd", "TSK_ADMIN", [staffUser.id, tskAdminUser.id]) && eq2("assessUpd", "TSK_STAFF", [staffUser.id]) &&
      eq2("assessUpd", "TSK_STAFF-tanpa-user", []) && eq2("assessUpd", "TSK_B", blk.adminBId) &&
      eq2("assessUpd", "LPK_ADMIN", [blk.hSensei[0], blk.hAdmin[0]]) && none("assessUpd", ["LPK_SENSEI", "LPK_NULL"]),
    `TSK_ADMIN: ${blk["assessUpd/TSK_ADMIN"]?.length} baris, LPK_ADMIN: ${blk["assessUpd/LPK_ADMIN"]?.length}`,
  );
  check(
    "DELETE tanpa WHERE pada penilaian: ditolak untuk semua peran (tidak ada yang terhapus)",
    ["TSK_ADMIN", "TSK_STAFF", "TSK_B", "LPK_ADMIN", "LPK_SENSEI", "LPK_NULL"].every((w) => eq2("assessDel", w, [])),
  );
  check(
    "DELETE tanpa WHERE pada dokumen: TSK hanya menghapus dokumen kandidat yang boleh diedit (keputusan membuka hak edit); TSK lain hanya miliknya; sensei/peran null tidak sama sekali",
    eq2("docsDel", "TSK_ADMIN", [pciLpk1]) && eq2("docsDel", "TSK_STAFF", [pciLpk1]) && eq2("docsDel", "TSK_STAFF-tanpa-user", [pciLpk1]) &&
      eq2("docsDel", "TSK_B", [ready1.id]) && none("docsDel", ["LPK_SENSEI", "LPK_NULL"]) && eq2("docsDel", "LPK_ADMIN", [ready1.id, pciLpk1]),
    `TSK menghapus dokumen ${blk["docsDel/TSK_ADMIN"]?.length}/1 kandidat`,
  );
  check(
    "DELETE tanpa WHERE pada data keluarga (tabel anak lain): TSK tidak pernah bisa menghapus, Admin LPK bisa",
    none("familyDel", ["TSK_ADMIN", "TSK_STAFF", "TSK_B", "LPK_SENSEI", "LPK_NULL"]) && eq2("familyDel", "LPK_ADMIN", [ready1.id, pciLpk1]),
  );
  check(
    "UPDATE tanpa WHERE pada candidate_selections: hanya TSK pemilik yang berubah (LPK tidak bisa; TSK lain hanya barisnya sendiri)",
    none("selections", ["LPK_ADMIN", "LPK_SENSEI", "LPK_NULL"]) &&
      (blk["selections/TSK_ADMIN"] ?? []).length > 0 && (blk["selections/TSK_ADMIN"] ?? []).every((id) => id === tsk.id) &&
      eq2("selections", "TSK_B", blk.tskBId),
    `TSK A mengubah ${blk["selections/TSK_ADMIN"]?.length} baris, semuanya miliknya`,
  );
  check(
    "UPDATE tanpa WHERE pada candidate_notes: penulis hanya catatannya, TSK_ADMIN hanya catatan organisasinya, staf tanpa user dan LPK tidak sama sekali",
    (blk["notes/TSK_ADMIN"] ?? []).length > 0 && !(blk["notes/TSK_ADMIN"] ?? []).includes(blk.adminBId[0]) &&
      (blk["notes/TSK_STAFF"] ?? []).length === 1 && blk["notes/TSK_STAFF"][0] === staffUser.id &&
      eq2("notes", "TSK_B", blk.adminBId) &&
      none("notes", ["TSK_STAFF-tanpa-user", "LPK_ADMIN", "LPK_SENSEI", "LPK_NULL"]),
    `TSK_ADMIN A: ${blk["notes/TSK_ADMIN"]?.length} catatan, staf: ${blk["notes/TSK_STAFF"]?.length}, TSK_ADMIN B: ${blk["notes/TSK_B"]?.length}`,
  );

  // --- I. Berbagi ke TSK (shared_with_tsk): gerbang tunggal visibilitas TSK, di SEMUA tabel turunan ---
  const sh: Record<string, unknown> = {};
  const lpkAdminUser = allUsers.find((u) => u.role === "LPK_ADMIN" && u.organizationId === lpk1.id)!;
  type Counts = { cand: number; priv: number; fam: number; edu: number; work: number; cert: number; docs: number; sel: number; notes: number; assess: number; plc: number };
  await sandbox(async (tx) => {
    // Data lengkap di setiap tabel turunan untuk ready1, plus keputusan TSK yang membuka hak edit
    await tx.insert(candidatePrivate).values({ candidateId: ready1.id, nationalId: NIK });
    await tx.insert(candidateFamilyMembers).values({ candidateId: ready1.id, relation: "FATHER", name: "Ayah Uji" });
    await tx.insert(candidateEducations).values({ candidateId: ready1.id, schoolName: "SMK Uji" });
    await tx.insert(candidateWorkHistories).values({ candidateId: ready1.id, companyName: "PT Uji" });
    await tx.insert(candidateCertificates).values({ candidateId: ready1.id, type: "JLPT", levelOrField: "N4" });
    await tx.insert(candidateDocuments).values(sampleDoc(ready1.id));
    await decide(tx, ready1.id, tsk.id, "DEPARTED"); // membuka hak edit DAN membuat penempatan ACTIVE (trigger)
    // Penilaian (baris uji bertahun 2020; baris seed bulan-bulan terakhir tidak dihitung): 1 LPK_MONTHLY + 2 TSK_VISIT (satu dibagikan)
    await tx.insert(candidateAssessments).values([
      { candidateId: ready1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessorId: lpkAdminUser.id, assessedOn: "2020-06-10" },
      { candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessorId: staffUser.id, assessedOn: "2020-06-11" },
      { candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessorId: tskAdminUser.id, assessedOn: "2020-06-12", visibility: "SHARED_WITH_LPK" },
    ]);
    await tx.insert(candidateNotes).values([
      { candidateId: ready1.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "catatan hanya TSK" },
      { candidateId: ready1.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "catatan dibagikan ke LPK", visibility: "SHARED_WITH_LPK" },
    ]);
    const count = async (label: string, orgId: string, role: string, userId: string | null = null) => {
      await actAs(tx, orgId, role, userId);
      const n = async (q: Promise<unknown[]>) => (await q).length;
      const c: Counts = {
        cand: await n(tx.select().from(candidates).where(eq(candidates.id, ready1.id))),
        priv: await n(tx.select().from(candidatePrivate).where(eq(candidatePrivate.candidateId, ready1.id))),
        fam: await n(tx.select().from(candidateFamilyMembers).where(eq(candidateFamilyMembers.candidateId, ready1.id))),
        edu: await n(tx.select().from(candidateEducations).where(eq(candidateEducations.candidateId, ready1.id))),
        work: await n(tx.select().from(candidateWorkHistories).where(eq(candidateWorkHistories.candidateId, ready1.id))),
        cert: await n(tx.select().from(candidateCertificates).where(eq(candidateCertificates.candidateId, ready1.id))),
        docs: await n(tx.select().from(candidateDocuments).where(eq(candidateDocuments.candidateId, ready1.id))),
        sel: await n(tx.select().from(candidateSelections).where(eq(candidateSelections.candidateId, ready1.id))),
        notes: await n(tx.select().from(candidateNotes).where(eq(candidateNotes.candidateId, ready1.id))),
        assess: await n(tx.select().from(candidateAssessments).where(and(eq(candidateAssessments.candidateId, ready1.id), lt(candidateAssessments.period, "2021-01-01")))),
        plc: await n(tx.select().from(placements).where(eq(placements.candidateId, ready1.id))),
      };
      sh[label] = c;
    };
    const setShare = async (value: boolean, userId: string | null) => {
      await actAs(tx, lpk1.id, "LPK_ADMIN", userId);
      return (await tx.update(candidates).set({ sharedWithTsk: value }).where(eq(candidates.id, ready1.id)).returning())[0];
    };

    await count("on1/tsk", tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await count("on1/lpk", lpk1.id, "LPK_ADMIN");
    sh.stampOn0 = (await tx.select().from(candidates).where(eq(candidates.id, ready1.id)))[0].sharedWithTskAt; // tidak berubah sejak seed

    // Dimatikan oleh LPK_ADMIN
    const off = await setShare(false, lpkAdminUser.id);
    sh.stampOff = [off.sharedWithTskAt, off.sharedWithTskBy];
    await count("off/tsk", tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await count("off/tsk-staff", tsk.id, "TSK_STAFF", staffUser.id);
    await count("off/lpk", lpk1.id, "LPK_ADMIN");
    // TSK (dengan keputusan yang membuka hak edit) tidak bisa menulis apa pun saat tidak dibagikan
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    sh.offEditCand = (await rowsOf(tx, (t) => t.update(candidates).set({ hobby: uniq() }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
    sh.offEditPriv = (await rowsOf(tx, (t) => t.update(candidatePrivate).set({ phone: uniq() }).where(eq(candidatePrivate.candidateId, ready1.id)).returning({ id: candidatePrivate.candidateId }))).n;
    sh.offDoc = await attempt(tx, (t) => t.insert(candidateDocuments).values(sampleDoc(ready1.id)));
    sh.offNote = await attempt(tx, (t) => t.insert(candidateNotes).values({ candidateId: ready1.id, tskOrgId: tsk.id, authorId: tskAdminUser.id, body: "x" }));
    sh.offDecision = (await rowsOf(tx, (t) => t.update(candidateSelections).set({ decision: "DEPARTED" }).where(eq(candidateSelections.candidateId, ready1.id)).returning({ id: candidateSelections.id }))).n;
    sh.offAudit = await attempt(tx, (t) =>
      t.insert(auditLogs).values({ organizationId: lpk1.id, actorOrgId: tsk.id, candidateId: ready1.id, actorUserId: tskAdminUser.id, action: "x", entity: "candidate", entityId: ready1.id }),
    );

    // Diaktifkan lagi: semua data yang tadinya ada muncul lagi (tidak ada yang dihapus)
    const on = await setShare(true, lpkAdminUser.id);
    sh.stampOn = [on.sharedWithTskAt !== null, on.sharedWithTskBy];
    await count("on2/tsk", tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await count("on2/lpk", lpk1.id, "LPK_ADMIN");

    // Siapa boleh mengubah kolom berbagi: hanya LPK_ADMIN
    await actAs(tx, lpk1.id, "LPK_SENSEI", randomUUID());
    sh.senseiRows = (await rowsOf(tx, (t) => t.update(candidates).set({ sharedWithTsk: false }).where(eq(candidates.id, ready1.id)).returning({ id: candidates.id }))).n;
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    sh.tskOff = await attempt(tx, (t) => t.update(candidates).set({ sharedWithTsk: false }).where(eq(candidates.id, ready1.id)));
    sh.tskStamp = await attempt(tx, (t) => t.update(candidates).set({ sharedWithTskBy: tskAdminUser.id }).where(eq(candidates.id, ready1.id)));
    await actAsSystem(tx);
    sh.stillOn = (await tx.select().from(candidates).where(eq(candidates.id, ready1.id)))[0].sharedWithTsk;

    // Kandidat baru: bawaan TIDAK dibagikan; LPK_ADMIN boleh membuat langsung dibagikan (pelaku tercatat oleh trigger)
    await actAs(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    const [def] = await tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Baru Default" }).returning();
    const [direct] = await tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Baru Dibagikan", sharedWithTsk: true }).returning();
    sh.newDefault = def.sharedWithTsk;
    sh.newShared = [direct.sharedWithTsk, direct.sharedWithTskBy];
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    sh.newSeen = (await tx.select().from(candidates).where(inArray(candidates.id, [def.id, direct.id]))).map((c) => c.fullName);

    // Tidak ada yang tertinggal: policy/fungsi lama yang menyebut data_consent_date, dan tabel baru ber-candidate_id
    const pol = await tx.execute(sql`select tablename, policyname from pg_policies where schemaname = 'public' and (coalesce(qual, '') like '%data_consent_date%' or coalesce(with_check, '') like '%data_consent_date%')`);
    const fns = await tx.execute(sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc like '%data_consent_date%' order by 1`);
    const tabs = await tx.execute(sql`select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name where c.table_schema = 'public' and c.column_name = 'candidate_id' and t.table_type = 'BASE TABLE' order by 1`);
    sh.leftoverPolicies = pol.rows.map((r) => `${r.tablename}.${r.policyname}`);
    sh.leftoverFns = fns.rows.map((r) => String(r.proname));
    sh.candidateTables = tabs.rows.map((r) => String(r.table_name));
  });
  const FULL_ON: Counts = { cand: 1, priv: 1, fam: 1, edu: 1, work: 1, cert: 1, docs: 1, sel: 1, notes: 2, assess: 3, plc: 1 };
  const ZERO: Counts = { cand: 0, priv: 0, fam: 0, edu: 0, work: 0, cert: 0, docs: 0, sel: 0, notes: 0, assess: 0, plc: 0 };
  const J = JSON.stringify;
  check(
    "Dibagikan: TSK melihat kandidat dan SEMUA tabel turunannya (data sensitif, keluarga, pendidikan, kerja, sertifikat, dokumen, keputusan, catatan)",
    J(sh["on1/tsk"]) === J(FULL_ON),
    J(sh["on1/tsk"]),
  );
  check(
    "Dimatikan: TSK (admin dan staf) tidak melihat apa pun di SEMUA tabel itu; LPK tetap melihat datanya sendiri",
    J(sh["off/tsk"]) === J(ZERO) && J(sh["off/tsk-staff"]) === J(ZERO) &&
      J(sh["off/lpk"]) === J({ ...FULL_ON, notes: 0, assess: 1, plc: 0 }), // LPK tidak pernah membaca penempatan
    `TSK: ${J(sh["off/tsk"])} | LPK: ${J(sh["off/lpk"])}`,
  );
  check(
    "Dimatikan: catatan TSK yang dibagikan ke LPK ikut tidak terlihat oleh LPK (pola kemitraan nonaktif); keputusan TSK tetap terbaca LPK",
    (sh["off/lpk"] as Counts).notes === 0 && (sh["on1/lpk"] as Counts).notes === 1 && (sh["off/lpk"] as Counts).sel === 1,
    `LPK catatan: ${(sh["on1/lpk"] as Counts).notes} -> ${(sh["off/lpk"] as Counts).notes}`,
  );
  check(
    "Dimatikan: TSK tidak bisa menulis walau keputusannya membuka hak edit (ubah data, data sensitif, unggah dokumen, tulis catatan, ubah keputusan, tulis audit)",
    sh.offEditCand === 0 && sh.offEditPriv === 0 && typeof sh.offDoc === "string" && typeof sh.offNote === "string" &&
      sh.offDecision === 0 && typeof sh.offAudit === "string",
  );
  check(
    "Diaktifkan lagi: semua data TSK muncul lagi persis seperti semula (tidak ada yang dihapus saat dimatikan)",
    J(sh["on2/tsk"]) === J(FULL_ON) && J(sh["on2/lpk"]) === J(sh["on1/lpk"]),
    J(sh["on2/tsk"]),
  );
  check(
    "Cap waktu dan pelaku diisi trigger: aktif -> pelaku = user LPK yang login; dimatikan -> dikosongkan",
    J(sh.stampOff) === J([null, null]) && J(sh.stampOn) === J([true, lpkAdminUser.id]),
    `${J(sh.stampOff)} / ${J(sh.stampOn)}`,
  );
  check(
    "Hanya LPK_ADMIN yang bisa mengubah shared_with_tsk*: sensei 0 baris, TSK (walau punya hak edit) ditolak trigger; nilai tidak berubah",
    sh.senseiRows === 0 && typeof sh.tskOff === "string" && /hanya bisa diubah oleh LPK/.test(sh.tskOff) &&
      typeof sh.tskStamp === "string" && sh.stillOn === true,
  );
  check(
    "Kandidat baru: bawaan TIDAK dibagikan (TSK tidak melihatnya); LPK_ADMIN boleh membuat langsung dibagikan",
    sh.newDefault === false && J(sh.newShared) === J([true, lpkAdminUser.id]) && J(sh.newSeen) === J(["Baru Dibagikan"]),
    J(sh.newSeen),
  );
  check(
    "Tuntas: tidak ada policy yang masih menyebut data_consent_date, dan hanya trigger penjaga TSK yang menyebutnya di fungsi",
    J(sh.leftoverPolicies) === "[]" && J(sh.leftoverFns) === J(["enforce_tsk_cannot_change_lpk_fields"]),
    `${J(sh.leftoverPolicies)} ${J(sh.leftoverFns)}`,
  );
  const covered = ["activity_case_subjects", "activity_record_subjects", "audit_logs", "candidate_assessments", "candidate_certificates", "candidate_documents", "candidate_educations", "candidate_family_members", "candidate_notes", "candidate_private", "candidate_selections", "candidate_work_histories", "periodic_interview_quarter_notes", "periodic_interviews", "placements", "residence_cards"];
  check(
    "Tuntas: setiap tabel ber-candidate_id sudah tercakup tes berbagi (tabel baru ber-candidate_id harus ditambahkan ke bagian I)",
    J(sh.candidateTables) === J(covered),
    J(sh.candidateTables),
  );

  // --- J. Penilaian (candidate_assessments) ---
  // Form LPK membatasi tanggal ke "hari ini" menurut APP_TIMEZONE (Jakarta); trigger memakai tanggal Tokyo.
  // Bukti bahwa tanggal Jakarta TIDAK PERNAH melewati tanggal Tokyo (jadi form tidak pernah ditolak trigger): 72 instan per jam.
  {
    const rows = await withSystem((tx) =>
      tx.execute(sql`select g::text as ts, ((g at time zone 'Asia/Jakarta')::date)::text as jkt, ((g at time zone 'Asia/Tokyo')::date)::text as tyo
        from generate_series(timestamptz '2026-03-01 00:00+00', timestamptz '2026-03-03 23:00+00', interval '1 hour') g`),
    );
    const list = rows.rows as Array<{ ts: string; jkt: string; tyo: string }>;
    check(
      "Zona waktu: tanggal Jakarta (batas form) tidak pernah melewati tanggal Tokyo (batas trigger), dan todayInAppTz sama dengan SQL",
      list.length === 72 && list.every((r) => r.jkt <= r.tyo && todayInAppTz(new Date(r.ts)) === r.jkt),
      `${list.length} instan; ${list.filter((r) => r.jkt > r.tyo || todayInAppTz(new Date(r.ts)) !== r.jkt).length} pelanggaran`,
    );
  }
  const senseiUser = allUsers.find((u) => u.email === "lpk1.sensei@hashi.test")!;
  const OLD = "2021-01-01"; // baris uji memakai 2020; baris seed memakai bulan-bulan terakhir
  const INTERVIEW_OK = ["PASSED_TSK_INTERVIEW", "SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"]; // sengaja eksplisit
  const as_: Record<string, unknown> = {};
  const secretAssessment = "RAHASIA-penilaian-TSK-5521";
  await sandbox(async (tx) => {
    const sensei2 = (await tx.insert(users).values({ organizationId: lpk1.id, email: `sensei2-${uniq()}@hashi.test`, name: "Sensei Dua", role: "LPK_SENSEI", passwordHash: "x" }).returning())[0].id;
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const base = (kind: "LPK_MONTHLY" | "TSK_INTERVIEW" | "TSK_VISIT", orgId: string, assessorId: string, assessedOn: string, extra: Partial<typeof candidateAssessments.$inferInsert> = {}) =>
      ({ candidateId: ready1.id, orgId, kind, assessorId, assessedOn, ...extra });
    const ins = async (v: ReturnType<typeof base>) => (await tx.insert(candidateAssessments).values(v).returning())[0];
    const mA = await ins(base("LPK_MONTHLY", lpk1.id, senseiUser.id, "2020-01-17", { note: "bulan A" }));
    const mB = await ins(base("LPK_MONTHLY", lpk1.id, lpkAdminUser.id, "2020-02-17"));
    const tOnly = await ins(base("TSK_VISIT", tsk.id, staffUser.id, "2020-03-05", { note: secretAssessment }));
    const tShared = await ins(base("TSK_INTERVIEW", tsk.id, tskAdminUser.id, "2020-03-06", { visibility: "SHARED_WITH_LPK" }));
    const bOnly = await ins(base("TSK_VISIT", tskB, adminB, "2020-03-07"));
    const bShared = await ins(base("TSK_VISIT", tskB, adminB, "2020-03-08", { visibility: "SHARED_WITH_LPK" }));
    // kandidat yang TIDAK dibagikan
    const hMonthly = (await tx.insert(candidateAssessments).values({ candidateId: hidden.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessorId: senseiUser.id, assessedOn: "2020-01-10" }).returning())[0];
    const mine = [mA.id, mB.id, tOnly.id, tShared.id, bOnly.id, bShared.id];
    const name = new Map<string, string>([[mA.id, "mA"], [mB.id, "mB"], [tOnly.id, "tOnly"], [tShared.id, "tShared"], [bOnly.id, "bOnly"], [bShared.id, "bShared"]]);
    const see = async (label: string, orgId: string, role: string | null, userId: string | null = null) => {
      await actAs(tx, orgId, role, userId);
      const rows = await tx.select({ id: candidateAssessments.id }).from(candidateAssessments).where(inArray(candidateAssessments.id, mine));
      as_[`see/${label}`] = rows.map((r) => name.get(r.id)).sort();
    };
    await see("sensei", lpk1.id, "LPK_SENSEI", senseiUser.id);
    await see("lpk-admin", lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    await see("lpk2", lpk2.id, "LPK_ADMIN");
    await see("lpk-null", lpk1.id, null);
    await see("tsk-admin", tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await see("tsk-staff", tsk.id, "TSK_STAFF", staffUser.id);
    await see("tsk-b", tskB, "TSK_ADMIN", adminB);
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    as_.hiddenSeenByTsk = (await tx.select().from(candidateAssessments).where(eq(candidateAssessments.candidateId, hidden.id))).length;
    as_.hiddenVisit = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: hidden.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: "2020-05-01" }));

    // --- tulis: sensei ---
    await actAs(tx, lpk1.id, "LPK_SENSEI", senseiUser.id);
    const forged = await tx.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-04-10", assessorId: lpkAdminUser.id, scoreJapanese: 3 }).returning();
    as_.senseiInsert = [forged[0].assessorId === senseiUser.id, forged[0].period]; // penilai = yang login, bukan yang dikirim
    as_.senseiDup = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-01-25" }));
    as_.senseiOtherCand = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: studying1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-01-25" }));
    as_.senseiVisit = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: lpk1.id, kind: "TSK_VISIT", assessedOn: "2020-06-01" }));
    as_.senseiVisitAsTsk = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: "2020-06-01" }));
    as_.senseiFuture = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2999-01-01" }));
    as_.senseiShared = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: studying1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-02-02", visibility: "SHARED_WITH_LPK" }));
    as_.score6 = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: studying1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-02-03", scoreJapanese: 6 }));
    as_.attend101 = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: studying1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-02-03", attendancePct: 101 }));
    as_.senseiOwn = (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ followUp: uniq() }).where(eq(candidateAssessments.id, mA.id)).returning({ id: candidateAssessments.id }))).n;
    as_.senseiAdminsRow = (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ followUp: uniq() }).where(eq(candidateAssessments.id, mB.id)).returning({ id: candidateAssessments.id }))).n;
    const moved = await tx.update(candidateAssessments).set({ assessedOn: "2020-05-11" }).where(eq(candidateAssessments.id, forged[0].id)).returning();
    as_.periodRecalc = moved[0].period;
    as_.senseiKind = await attempt(tx, (t) => t.update(candidateAssessments).set({ kind: "TSK_VISIT" }).where(eq(candidateAssessments.id, mA.id)));
    as_.senseiAssessor = await attempt(tx, (t) => t.update(candidateAssessments).set({ assessorId: lpkAdminUser.id }).where(eq(candidateAssessments.id, mA.id)));
    as_.senseiOrg = await attempt(tx, (t) => t.update(candidateAssessments).set({ orgId: lpk2.id }).where(eq(candidateAssessments.id, mA.id)));
    as_.senseiCandidate = await attempt(tx, (t) => t.update(candidateAssessments).set({ candidateId: studying1.id }).where(eq(candidateAssessments.id, mA.id)));
    as_.senseiDelete = await attempt(tx, (t) => t.delete(candidateAssessments).where(eq(candidateAssessments.id, mA.id)));
    await actAs(tx, lpk1.id, "LPK_SENSEI", null);
    as_.senseiNoUser = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-07-01" }));
    await actAs(tx, lpk1.id, "LPK_SENSEI", sensei2);
    as_.otherSensei = (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ followUp: uniq() }).where(eq(candidateAssessments.id, mA.id)).returning({ id: candidateAssessments.id }))).n;
    await actAs(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    as_.adminBoth = [
      (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ followUp: uniq() }).where(eq(candidateAssessments.id, mA.id)).returning({ id: candidateAssessments.id }))).n,
      (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ followUp: uniq() }).where(eq(candidateAssessments.id, mB.id)).returning({ id: candidateAssessments.id }))).n,
    ];
    as_.adminTskKind = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: lpk1.id, kind: "TSK_INTERVIEW", assessedOn: "2020-06-02" }));
    as_.adminUpdatesTsk = (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ followUp: uniq() }).where(eq(candidateAssessments.id, tOnly.id)).returning({ id: candidateAssessments.id }))).n;

    // --- tulis: TSK ---
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    as_.tskMonthly = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "LPK_MONTHLY", assessedOn: "2020-08-01" }));
    as_.tskMonthlyAsLpk = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-08-02" }));
    as_.visitTwice = [
      await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: "2020-03-20" })),
      await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: "2020-03-21" })),
    ]; // TSK boleh lebih dari satu per bulan (batas satu-per-bulan hanya untuk LPK_MONTHLY)
    as_.noDecisionInterview = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "TSK_INTERVIEW", assessedOn: "2020-09-01" }));
    as_.noDecisionVisit = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: "2020-09-01" }));
    for (const d of selectionDecision.enumValues) {
      await actAsSystem(tx);
      await decide(tx, ready1.id, tsk.id, d);
      await scratch(tx, async (sp) => {
        await actAs(sp, tsk.id, "TSK_ADMIN", tskAdminUser.id);
        const iv = await attempt(sp, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "TSK_INTERVIEW", assessedOn: "2020-10-01" }));
        const vs = await attempt(sp, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: "2020-10-01" }));
        as_[`iv/${d}`] = [iv === null, vs === null];
      });
    }
    // keputusan TSK A membuka interview; TSK B (keputusannya milik A, bukan B) tetap ditolak
    await actAsSystem(tx);
    await decide(tx, ready1.id, tsk.id, "PASSED_CLIENT_INTERVIEW");
    await actAs(tx, tskB, "TSK_ADMIN", adminB);
    as_.bInterview = await attempt(tx, (t) => t.insert(candidateAssessments).values({ candidateId: ready1.id, orgId: tskB, kind: "TSK_INTERVIEW", assessedOn: "2020-10-02" }));
    // LPK_MONTHLY TIDAK PERNAH bisa diubah TSK, walau keputusannya PASSED_CLIENT_INTERVIEW (hak edit data terbuka)
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    as_.tskEditMonthly = (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ note: "diubah TSK" }).where(eq(candidateAssessments.id, mA.id)).returning({ id: candidateAssessments.id }))).n;
    as_.tskDelete = await attempt(tx, (t) => t.delete(candidateAssessments).where(eq(candidateAssessments.id, tOnly.id)));
    // mengubah penilaian TSK: penilainya atau TSK_ADMIN di organisasi yang sama
    const tskUpd = async (label: string, orgId: string, role: string, userId: string | null) => {
      await actAs(tx, orgId, role, userId);
      as_[`tskUpd/${label}`] = (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ followUp: uniq() }).where(eq(candidateAssessments.id, tOnly.id)).returning({ id: candidateAssessments.id }))).n;
    };
    await tskUpd("penulis-staf", tsk.id, "TSK_STAFF", staffUser.id);
    await tskUpd("staf-lain", tsk.id, "TSK_STAFF", randomUUID());
    await tskUpd("staf-tanpa-user", tsk.id, "TSK_STAFF", null);
    await tskUpd("admin", tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await tskUpd("admin-tsk-lain", tskB, "TSK_ADMIN", adminB);
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    as_.tskKindChange = await attempt(tx, (t) => t.update(candidateAssessments).set({ kind: "TSK_INTERVIEW" }).where(eq(candidateAssessments.id, tOnly.id)));
    as_.tskMakeShared = (await rowsOf(tx, (t) => t.update(candidateAssessments).set({ visibility: "SHARED_WITH_LPK" }).where(eq(candidateAssessments.id, tOnly.id)).returning({ id: candidateAssessments.id }))).n;
    await see("lpk-admin-after-share", lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    await see("lpk-sensei-after-share", lpk1.id, "LPK_SENSEI", senseiUser.id);
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await tx.update(candidateAssessments).set({ visibility: "TSK_ONLY" }).where(eq(candidateAssessments.id, tOnly.id));
    await see("lpk-admin-after-unshare", lpk1.id, "LPK_ADMIN", lpkAdminUser.id);

    // kemitraan TSK A dihentikan: penilaian TSK-nya yang dibagikan hilang dari LPK (pola kemitraan nonaktif)
    await actAsSystem(tx);
    await tx.update(partnerships).set({ active: false }).where(and(eq(partnerships.lpkId, lpk1.id), eq(partnerships.tskId, tsk.id)));
    await see("lpk-admin-partnership-off", lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    await see("tsk-admin-partnership-off", tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await actAsSystem(tx); // `see` berpindah identitas; pemulihan kemitraan harus oleh sistem
    await tx.update(partnerships).set({ active: true }).where(and(eq(partnerships.lpkId, lpk1.id), eq(partnerships.tskId, tsk.id)));
    // kandidat dimatikan berbagi-nya: TSK tidak melihat apa pun, penilaian TSK yang dibagikan hilang dari LPK
    await tx.update(candidates).set({ sharedWithTsk: false }).where(eq(candidates.id, ready1.id));
    await see("tsk-admin-unshared", tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await see("lpk-admin-unshared", lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    await see("sensei-unshared", lpk1.id, "LPK_SENSEI", senseiUser.id);
    as_.hMonthly = hMonthly.id;

    // --- audit penilaian: tanpa isi note/follow_up ---
    await actAsSystem(tx);
    await tx.update(candidates).set({ sharedWithTsk: true }).where(eq(candidates.id, ready1.id));
    const entries = [
      assessmentAuditEntry({ action: "assessment.create", assessment: tOnly, lpkOrgId: lpk1.id, actorOrgId: tsk.id, actorUserId: tskAdminUser.id, changed: ["note", "scoreJapanese", "assessedOn"] }),
      assessmentAuditEntry({ action: "assessment.update", assessment: tOnly, lpkOrgId: lpk1.id, actorOrgId: tsk.id, actorUserId: tskAdminUser.id, changed: ["followUp"], visibility: { from: "SHARED_WITH_LPK", to: "TSK_ONLY" } }),
    ];
    as_.auditEntries = entries;
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    as_.auditInsert = await attempt(tx, (t) => t.insert(auditLogs).values(entries));
    await actAs(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    as_.auditAllLpk = JSON.stringify(await tx.select().from(auditLogs));
  });
  const S2 = (k: string) => JSON.stringify(as_[k]);
  check(
    "Sensei membaca LPK_MONTHLY (dari LPK-nya) tetapi TIDAK membaca satu pun penilaian TSK, termasuk yang dibagikan",
    S2("see/sensei") === '["mA","mB"]' && S2("see/lpk-sensei-after-share") === '["mA","mB"]',
    S2("see/sensei"),
  );
  check(
    "LPK_ADMIN membaca LPK_MONTHLY + penilaian TSK yang SHARED_WITH_LPK (dari semua TSK mitra), bukan yang TSK_ONLY",
    S2("see/lpk-admin") === '["bShared","mA","mB","tShared"]',
    S2("see/lpk-admin"),
  );
  check("LPK lain dan peran null tidak membaca penilaian apa pun", S2("see/lpk2") === "[]" && S2("see/lpk-null") === "[]");
  check(
    "TSK membaca semua LPK_MONTHLY kandidat yang dibagikan + penilaian TSK milik organisasinya saja; TSK lain tidak membaca penilaian TSK itu",
    S2("see/tsk-admin") === '["mA","mB","tOnly","tShared"]' && S2("see/tsk-staff") === '["mA","mB","tOnly","tShared"]' && S2("see/tsk-b") === '["bOnly","bShared","mA","mB"]',
    `A: ${S2("see/tsk-admin")} | B: ${S2("see/tsk-b")}`,
  );
  check(
    "TSK mengubah penilaian ke SHARED_WITH_LPK -> terbaca LPK_ADMIN (bukan sensei); dikembalikan TSK_ONLY -> hilang lagi dari LPK",
    as_.tskMakeShared === 1 && S2("see/lpk-admin-after-share") === '["bShared","mA","mB","tOnly","tShared"]' &&
      S2("see/lpk-sensei-after-share") === '["mA","mB"]' && S2("see/lpk-admin-after-unshare") === '["bShared","mA","mB","tShared"]',
  );
  check(
    "Kemitraan TSK dihentikan: penilaian TSK itu yang dibagikan hilang dari LPK; TSK-nya tidak membaca apa pun",
    S2("see/lpk-admin-partnership-off") === '["bShared","mA","mB"]' && S2("see/tsk-admin-partnership-off") === "[]",
    S2("see/lpk-admin-partnership-off"),
  );
  check(
    "Kandidat tidak dibagikan: TSK tidak melihat penilaian apa pun (LPK_MONTHLY pun), tidak bisa membuat TSK_VISIT; LPK tidak melihat penilaian TSK yang dibagikan",
    S2("see/tsk-admin-unshared") === "[]" && as_.hiddenSeenByTsk === 0 && typeof as_.hiddenVisit === "string" && /row-level security/.test(as_.hiddenVisit as string) &&
      S2("see/lpk-admin-unshared") === '["mA","mB"]' && S2("see/sensei-unshared") === '["mA","mB"]',
    S2("see/lpk-admin-unshared"),
  );
  check(
    "Sensei membuat LPK_MONTHLY; penilai SELALU user yang login (assessor_id yang dikirim diabaikan), period = awal bulan; tanpa user ditolak",
    J(as_.senseiInsert) === J([true, "2020-04-01"]) && typeof as_.senseiNoUser === "string" && /penilai tidak dikenal/.test(as_.senseiNoUser),
    J(as_.senseiInsert),
  );
  check(
    "Penilaian bulan yang sama dua kali ditolak dengan pesan jelas (indeks candidate_assessments_lpk_month_key); kandidat lain / TSK_VISIT di bulan yang sama boleh",
    typeof as_.senseiDup === "string" && /candidate_assessments_lpk_month_key|duplicate key/.test(as_.senseiDup) &&
      as_.senseiOtherCand === null && J(as_.visitTwice) === "[null,null]",
    String(as_.senseiDup).slice(0, 90),
  );
  check(
    "Sensei mengubah penilaiannya sendiri, bukan milik Admin LPK dan bukan milik sensei lain; LPK_ADMIN mengubah keduanya; mengubah tanggal menghitung ulang period",
    as_.senseiOwn === 1 && as_.senseiAdminsRow === 0 && as_.otherSensei === 0 && J(as_.adminBoth) === "[1,1]" && as_.periodRecalc === "2020-05-01",
  );
  check(
    "LPK tidak bisa menulis penilaian TSK (jenis TSK_*, atas nama TSK, atau mengubah milik TSK) dan sensei tidak bisa membuat visibility SHARED di LPK_MONTHLY",
    [as_.senseiVisit, as_.senseiVisitAsTsk, as_.adminTskKind].every((e) => typeof e === "string" && /row-level security/.test(e)) &&
      as_.adminUpdatesTsk === 0 && typeof as_.senseiShared === "string" && /visibility_check/.test(as_.senseiShared),
  );
  check(
    "TSK TIDAK PERNAH bisa membuat atau mengubah LPK_MONTHLY (walau keputusannya PASSED_CLIENT_INTERVIEW); tidak ada DELETE untuk siapa pun",
    [as_.tskMonthly, as_.tskMonthlyAsLpk].every((e) => typeof e === "string" && /row-level security/.test(e)) && as_.tskEditMonthly === 0 &&
      [as_.tskDelete, as_.senseiDelete].every((e) => typeof e === "string" && /permission denied/.test(e)),
  );
  const ivBad = selectionDecision.enumValues.filter((d) => J(as_[`iv/${d}`]) !== J([INTERVIEW_OK.includes(d), true]));
  check(
    `TSK_INTERVIEW hanya bila keputusan IN (${INTERVIEW_OK.join(", ")}); TSK_VISIT diterima di semua keputusan`,
    ivBad.length === 0 && typeof as_.noDecisionInterview === "string" && as_.noDecisionVisit === null,
    ivBad.length ? `salah di: ${ivBad.join(", ")}` : `${selectionDecision.enumValues.length} keputusan diperiksa; tanpa baris keputusan: interview ditolak, visit diterima`,
  );
  check(
    "TSK_INTERVIEW mengikuti keputusan milik TSK ITU SENDIRI: TSK B ditolak walau TSK A punya keputusan yang sesuai",
    typeof as_.bInterview === "string" && /row-level security/.test(as_.bInterview),
  );
  check(
    "Mengubah penilaian TSK: penilainya dan TSK_ADMIN bisa; staf lain, staf tanpa user, TSK_ADMIN TSK lain ditolak; jenis tidak bisa diganti",
    as_["tskUpd/penulis-staf"] === 1 && as_["tskUpd/admin"] === 1 && as_["tskUpd/staf-lain"] === 0 && as_["tskUpd/staf-tanpa-user"] === 0 &&
      as_["tskUpd/admin-tsk-lain"] === 0 && typeof as_.tskKindChange === "string" && /tidak bisa diganti/.test(as_.tskKindChange),
  );
  check(
    "Kandidat, organisasi, jenis, dan penilai tidak bisa diganti; tanggal di masa depan, skor di luar 1-5, dan kehadiran di atas 100 ditolak",
    [as_.senseiKind, as_.senseiAssessor, as_.senseiOrg, as_.senseiCandidate].every((e) => typeof e === "string" && /tidak bisa diganti/.test(e)) &&
      typeof as_.senseiFuture === "string" && /masa depan/.test(as_.senseiFuture) &&
      typeof as_.score6 === "string" && /scores_check/.test(as_.score6) && typeof as_.attend101 === "string" && /attendance_check/.test(as_.attend101),
  );
  const ae = as_.auditEntries as Array<{ action: string; entityId: string; before?: Record<string, unknown>; after: Record<string, unknown> }>;
  check(
    "Audit penilaian hanya memuat jenis, periode, NAMA kolom, dan visibility dari/ke; isi note/follow_up tidak pernah ikut, dan tidak bocor ke audit yang terbaca LPK",
    as_.auditInsert === null && ae[1].before?.visibility === "SHARED_WITH_LPK" && ae[1].after.visibility === "TSK_ONLY" &&
      J(ae[0].after.fields) === J(["assessedOn", "note", "scoreJapanese"]) && ae[0].after.kind === "TSK_VISIT" &&
      !JSON.stringify(ae).includes(secretAssessment) && !(as_.auditAllLpk as string).includes(secretAssessment),
    J(ae[0].after),
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
    withTenant({ orgId: lpk1.id, role: "LPK_SENSEI" }, (tx) => tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Dari Sensei" }), db),
  );
  check("Sensei: tidak bisa menambah kandidat", senseiInsertErr !== null && /row-level security/i.test(senseiInsertErr), senseiInsertErr ?? "");
  const tskInsertErr = await inRollback(() =>
    withTenant({ orgId: tsk.id, role: "TSK_ADMIN" }, (tx) => tx.insert(candidates).values({ organizationId: lpk1.id, fullName: "Dari TSK" }), db),
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

  // --- K. Bahasa yang dikuasai pengguna (users.languages) ---
  const lang: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const target = (await tx.select({ id: users.id }).from(users).where(eq(users.email, "lpk1.sensei@hashi.test")))[0].id;
    const setLang = (t: Tx, literal: string) => t.execute(sql`update users set languages = ${literal}::language[] where id = ${target}`);
    lang.empty = await attempt(tx, (t) => setLang(t, "{}"));
    lang.dup = await attempt(tx, (t) => setLang(t, "{id,id}"));
    lang.dupMixed = await attempt(tx, (t) => setLang(t, "{id,ja,id}"));
    lang.outside = await attempt(tx, (t) => setLang(t, "{id,fr}"));
    lang.withNull = await attempt(tx, (t) => setLang(t, "{id,NULL}"));
    lang.nullArray = await attempt(tx, (t) => t.execute(sql`update users set languages = null where id = ${target}`));
    lang.ok = await attempt(tx, (t) => setLang(t, "{ja,en,id}"));
    lang.insertEmpty = await attempt(tx, (t) =>
      t.execute(sql`insert into users (organization_id, email, name, role, password_hash, languages) values (${lpk1.id}, ${`kosong-${uniq()}@hashi.test`}, 'Uji', 'LPK_SENSEI', 'x', '{}')`),
    );
    // Admin LPK1: bisa mengubah languages pengguna organisasinya; TANPA WHERE hanya menyentuh organisasinya; tidak menyentuh LPK lain
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    lang.ownRows = (await rowsOf(tx, (t) => t.update(users).set({ languages: ["en"] }).where(eq(users.id, target)).returning({ id: users.id }))).n;
    lang.allRows = (await rowsOf(tx, (t) => t.update(users).set({ languages: ["ja"] }).returning({ id: users.id }))).n;
  });
  const lpk1UserCount = (await withSystem((tx) => tx.select({ id: users.id }).from(users).where(eq(users.organizationId, lpk1.id)), db)).length;
  await sandbox(async (tx) => {
    const otherUser = (await tx.select({ id: users.id }).from(users).where(eq(users.email, "lpk2.admin@hashi.test")))[0].id;
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    lang.otherOrg = (await rowsOf(tx, (t) => t.update(users).set({ languages: ["en"] }).where(eq(users.id, otherUser)).returning({ id: users.id }))).n;
    await actAs(tx, lpk1.id, "LPK_SENSEI");
    lang.senseiOwn = (await rowsOf(tx, (t) => t.update(users).set({ languages: ["en"] }).where(eq(users.organizationId, lpk1.id)).returning({ id: users.id }))).n;
  });
  const bad = [lang.empty, lang.dup, lang.dupMixed, lang.outside, lang.withNull, lang.nullArray, lang.insertEmpty];
  check(
    "Bahasa pengguna: CHECK menolak array kosong, duplikat, nilai di luar id/ja/en, NULL; kombinasi valid diterima",
    bad.every((e) => typeof e === "string") && lang.ok === null && [lang.empty, lang.dup, lang.dupMixed, lang.withNull, lang.insertEmpty].every((e) => /users_languages_check/.test(String(e))) && /enum language/.test(String(lang.outside)),
    JSON.stringify(bad.map((e) => String(e).slice(0, 60))),
  );
  check(
    "Bahasa pengguna: admin hanya mengubah pengguna organisasinya (UPDATE tanpa WHERE hanya menyentuh organisasinya; LPK lain 0 baris)",
    lang.ownRows === 1 && lang.allRows === lpk1UserCount && lang.otherOrg === 0,
    `${lang.ownRows}/${lang.allRows}/${lang.otherOrg} dari ${lpk1UserCount}`,
  );

  // --- L. Hapus kandidat permanen: hanya LPK_ADMIN pemilik; blokir DOCUMENT_PROCESS / DEPARTED; cascade tuntas; audit bertahan ---
  const del: Record<string, unknown> = {};
  const BLOCKING = ["DOCUMENT_PROCESS", "DEPARTED"]; // sengaja eksplisit (jangan `>=` pada enum)
  const platformOrg = byName("Hashi Platform");
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const mk = async (label: string) => {
      const [c] = await tx.insert(candidates).values({ organizationId: lpk1.id, fullName: `Hapus Uji ${label}-${uniq()}`, gender: "MALE", birthDate: "2000-01-01", stage: "READY", sharedWithTsk: true }).returning();
      return c;
    };
    const fill = async (c: { id: string }) => {
      await tx.insert(candidatePrivate).values({ candidateId: c.id, nationalId: `DUMMY-${uniq()}` });
      await tx.insert(candidateFamilyMembers).values({ candidateId: c.id, relation: "FATHER", name: "Ayah Uji" });
      await tx.insert(candidateEducations).values({ candidateId: c.id, schoolName: "SMK Uji" });
      await tx.insert(candidateWorkHistories).values({ candidateId: c.id, companyName: "PT Uji" });
      await tx.insert(candidateCertificates).values({ candidateId: c.id, type: "JLPT", levelOrField: "N4" });
      await tx.insert(candidateDocuments).values([sampleDoc(c.id), sampleDoc(c.id)]);
      const sel = await selValues(tx, c.id, tsk.id, "PASSED_CLIENT_INTERVIEW"); // dengan job order (bukan keputusan pemblokir)
      await tx.insert(candidateSelections).values(sel);
      const [joRow] = await tx.select({ s: jobOrders.siteId }).from(jobOrders).where(eq(jobOrders.id, sel.jobOrderId!));
      await tx.insert(placements).values({ candidateId: c.id, orgId: tsk.id, siteId: joRow.s, jobOrderId: sel.jobOrderId, startDate: "2020-01-01", endDate: "2020-06-01", status: "ENDED" });
      await tx.insert(candidateNotes).values([{ candidateId: c.id, tskOrgId: tsk.id, body: "catatan uji", visibility: "TSK_ONLY" }, { candidateId: c.id, tskOrgId: tsk.id, body: "catatan dibagikan", visibility: "SHARED_WITH_LPK" }]);
      await tx.insert(candidateAssessments).values([
        { candidateId: c.id, orgId: lpk1.id, kind: "LPK_MONTHLY", assessedOn: "2020-01-10", assessorId: lpkAdminUser.id },
        { candidateId: c.id, orgId: tsk.id, kind: "TSK_VISIT", assessedOn: "2020-01-11", assessorId: tskAdminUser.id },
      ]);
    };
    const count = async (table: string, id: string) =>
      Number((await tx.execute(sql.raw(`select count(*)::int as n from ${table} where candidate_id = '${id}'`))).rows[0].n);
    const auditCount = async (id: string) => Number((await tx.execute(sql`select count(*)::int as n from audit_logs where candidate_id = ${id}`)).rows[0].n);
    const A = await mk("A");
    await fill(A);
    await tx.insert(auditLogs).values({ organizationId: lpk1.id, actorOrgId: lpk1.id, candidateId: A.id, action: "candidate.update", entity: "candidate", entityId: A.id });

    // ---- Siapa yang bisa menghapus: DELETE dengan WHERE dan TANPA WHERE (probe Part H) tidak mengenai satu baris pun, kecuali LPK_ADMIN pemilik
    const attemptsBy: Array<[string, string, string, string | null]> = [
      ["sensei", lpk1.id, "LPK_SENSEI", lpkAdminUser.id],
      ["tskAdmin", tsk.id, "TSK_ADMIN", tskAdminUser.id],
      ["tskStaff", tsk.id, "TSK_STAFF", staffUser.id],
      ["lpk2Admin", lpk2.id, "LPK_ADMIN", null],
      ["lpk3Admin", lpk3.id, "LPK_ADMIN", null],
      ["superAdmin", platformOrg.id, "SUPER_ADMIN", null],
      ["roleNull", lpk1.id, "", null],
      ["tskB", tskB, "TSK_ADMIN", null],
    ];
    for (const [label, org, role, uid] of attemptsBy) {
      await actAs(tx, org, role || null, uid);
      del[`where/${label}`] = (await rowsOf(tx, (t) => t.delete(candidates).where(eq(candidates.id, A.id)).returning({ id: candidates.id }))).n;
      del[`nowhere/${label}`] = await rowsOf(tx, (t) => t.delete(candidates).returning({ id: candidates.id }));
      del[`summary/${label}`] = (await tx.execute(sql`select candidate_delete_summary(${A.id}::uuid) as s`)).rows[0].s;
    }
    await actAsSystem(tx);
    del.stillThere = (await tx.select().from(candidates).where(eq(candidates.id, A.id))).length;

    // ---- Ringkasan untuk dialog: hanya LPK_ADMIN pemilik, angkanya cocok
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    del.summary = (await tx.execute(sql`select candidate_delete_summary(${A.id}::uuid) as s`)).rows[0].s;

    // ---- LPK_ADMIN pemilik: DELETE tanpa WHERE hanya mengenai kandidat organisasinya (dibatasi stage supaya tidak kena baris yang diblokir)
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    const withdrawnIds = (await rowsOf(tx, (t) => t.delete(candidates).where(eq(candidates.stage, "WITHDRAWN")).returning({ id: candidates.id, org: candidates.organizationId })));
    del.ownOrgOnly = withdrawnIds.err === null && withdrawnIds.n === all.filter((c) => c.organizationId === lpk1.id && c.stage === "WITHDRAWN").length;
    // DELETE tanpa WHERE sama sekali: ditolak trigger karena ada kandidat LPK-nya yang berstatus diproses/berangkat (tidak ada yang terhapus)
    del.nowhereOwner = await attempt(tx, (t) => t.delete(candidates));

    // ---- Hapus berhasil + cascade tuntas + audit bertambah
    const auditBefore = await auditCount(A.id);
    await actAs(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    await tx.insert(auditLogs).values({ organizationId: lpk1.id, actorOrgId: lpk1.id, candidateId: A.id, actorUserId: lpkAdminUser.id, action: "candidate.delete", entity: "candidate", entityId: A.id });
    del.deleted = (await rowsOf(tx, (t) => t.delete(candidates).where(eq(candidates.id, A.id)).returning({ id: candidates.id }))).n;
    await actAsSystem(tx);
    const tables = (await tx.execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'candidate_id' and table_name <> 'audit_logs' order by 1`)).rows.map((r) => String(r.table_name));
    const leftovers: string[] = [];
    for (const t of tables) if ((await count(t, A.id)) !== 0) leftovers.push(t);
    del.tables = tables;
    del.leftovers = leftovers;
    del.auditDelta = (await auditCount(A.id)) - auditBefore;
    del.candidateGone = (await tx.select().from(candidates).where(eq(candidates.id, A.id))).length;

    // ---- Blokir: keputusan DOCUMENT_PROCESS / DEPARTED menolak hapus (LPK_ADMIN pemilik DAN sistem); keputusan lain boleh
    for (const d of selectionDecision.enumValues) {
      const c = await mk(`B-${d}`);
      await tx.insert(candidateSelections).values(await selValues(tx, c.id, tsk.id, d));
      await actAs(tx, lpk1.id, "LPK_ADMIN");
      const r = await rowsOf(tx, (t) => t.delete(candidates).where(eq(candidates.id, c.id)).returning({ id: candidates.id }));
      const stillThere = (await tx.select().from(candidates).where(eq(candidates.id, c.id))).length;
      const blocked = BLOCKING.includes(d);
      del[`block/${d}`] = blocked ? r.err !== null && /tidak bisa dihapus/.test(r.err) && stillThere === 1 : r.err === null && r.n === 1 && stillThere === 0;
      if (blocked) {
        await actAsSystem(tx);
        const viaSystem = await rowsOf(tx, (t) => t.delete(candidates).where(eq(candidates.id, c.id)).returning({ id: candidates.id }));
        del[`blockSystem/${d}`] = viaSystem.err !== null && /tidak bisa dihapus/.test(viaSystem.err) && (await tx.select().from(candidates).where(eq(candidates.id, c.id))).length === 1;
      }
      await actAsSystem(tx);
    }
    // TSK lain yang memegang keputusan DEPARTED juga memblokir (trigger membaca keputusan SEMUA TSK, bukan hanya milik sesi)
    const D = await mk("TSKB");
    await tx.insert(candidateSelections).values([{ candidateId: D.id, tskOrgId: tsk.id, decision: "NONE" }, await selValues(tx, D.id, tskB, "DEPARTED")]);
    await actAs(tx, lpk1.id, "LPK_ADMIN");
    const viaOther = await rowsOf(tx, (t) => t.delete(candidates).where(eq(candidates.id, D.id)).returning({ id: candidates.id }));
    del.blockOtherTsk = viaOther.err !== null && /tidak bisa dihapus/.test(viaOther.err);
    await actAsSystem(tx);

    // ---- Jalur sah lain tidak terhalang: hapus organisasi (cascade) walau ada kandidat DEPARTED
    const [orgX] = await tx.insert(organizations).values({ name: "LPK Uji Cascade", type: "LPK", country: "ID", defaultLocale: "id" }).returning();
    const [cx] = await tx.insert(candidates).values({ organizationId: orgX.id, fullName: "Cascade Uji", gender: "MALE", birthDate: "2000-01-01", }).returning();
    await tx.insert(candidateSelections).values(await selValues(tx, cx.id, tsk.id, "DEPARTED"));
    del.orgCascade = await attempt(tx, (t) => t.delete(organizations).where(eq(organizations.id, orgX.id)));
    del.orgCascadeGone = (await tx.select().from(candidates).where(eq(candidates.id, cx.id))).length;
  });
  const none0 = (kind: string) => attemptsLabels.every((l) => del[`${kind}/${l}`] === 0);
  const attemptsLabels = ["sensei", "tskAdmin", "tskStaff", "lpk2Admin", "lpk3Admin", "superAdmin", "roleNull", "tskB"];
  // TANPA WHERE: LPK_ADMIN organisasi lain hanya bisa menghapus kandidat MILIKNYA (Medan: semua 12; Surabaya: ditolak trigger karena
  // ada kandidat diproses/berangkat), bukan kandidat uji di Bandung; peran lain tidak mengenai satu baris pun.
  const nw = (l: string) => del[`nowhere/${l}`] as { n: number; err: string | null };
  const zeroRows = ["sensei", "tskAdmin", "tskStaff", "superAdmin", "roleNull", "tskB"];
  check(
    "Hapus kandidat: DELETE (dengan dan TANPA WHERE) tidak mengenai satu baris pun untuk sensei, TSK_ADMIN, TSK_STAFF, super admin, peran null, dan TSK lain; LPK_ADMIN organisasi lain hanya kandidat miliknya sendiri",
    none0("where") && zeroRows.every((l) => nw(l).n === 0 && nw(l).err === null) &&
      nw("lpk3Admin").err === null && nw("lpk3Admin").n === ownCount(lpk3.id) &&
      nw("lpk2Admin").n === 0 && /tidak bisa dihapus/.test(String(nw("lpk2Admin").err)) &&
      del.stillThere === 1,
    JSON.stringify(attemptsLabels.map((l) => `${l}:${del[`where/${l}`]}/${nw(l).n}${nw(l).err ? "!" : ""}`)),
  );
  check(
    "Hapus kandidat: ringkasan jumlah data hanya untuk LPK_ADMIN pemilik (peran/organisasi lain mendapat NULL), angkanya cocok",
    attemptsLabels.every((l) => del[`summary/${l}`] === null) &&
      JSON.stringify(Object.entries(del.summary as object).sort()) === JSON.stringify(Object.entries({ documents: 2, assessmentsLpk: 1, assessmentsTsk: 1, notes: 2, selections: 1, placements: 1, privateRows: 1, family: 1, educations: 1, works: 1, certificates: 1, blocked: false }).sort()),
    JSON.stringify([del.summary, ...attemptsLabels.map((l) => `${l}:${JSON.stringify(del[`summary/${l}`])}`)]),
  );
  check("Hapus kandidat: DELETE tanpa WHERE oleh LPK_ADMIN hanya menyentuh organisasinya; tanpa pembatas ditolak trigger karena ada kandidat diproses/berangkat", del.ownOrgOnly === true && typeof del.nowhereOwner === "string" && /tidak bisa dihapus/.test(String(del.nowhereOwner)), String(del.nowhereOwner ?? ""));
  check(
    "Hapus kandidat: LPK_ADMIN pemilik berhasil; semua tabel ber-candidate_id kosong sesudahnya (diperiksa lewat information_schema), audit_logs justru bertambah 1",
    del.deleted === 1 && del.candidateGone === 0 && (del.leftovers as string[]).length === 0 && (del.tables as string[]).length >= 9 && del.auditDelta === 1,
    `tabel: ${(del.tables as string[]).join(",")}; sisa: ${(del.leftovers as string[]).join(",") || "-"}; audit +${del.auditDelta}`,
  );
  check(
    "Hapus kandidat: keputusan DOCUMENT_PROCESS dan DEPARTED memblokir (juga bagi sistem dan bila hanya TSK lain yang memegang keputusan itu); keputusan lain tidak",
    selectionDecision.enumValues.every((d) => del[`block/${d}`] === true) && BLOCKING.every((d) => del[`blockSystem/${d}`] === true) && del.blockOtherTsk === true,
    selectionDecision.enumValues.map((d) => `${d}:${del[`block/${d}`]}`).join(" "),
  );
  check("Hapus kandidat: hapus organisasi (cascade) tidak terhalang penjaga walau ada kandidat DEPARTED", del.orgCascade === null && del.orgCascadeGone === 0, String(del.orgCascade ?? ""));

  // --- M. Bidang kerja (skill_fields): semua peran membaca; menulis hanya mode sistem; kode tetap; yang dipakai tidak bisa dihapus ---
  const sfr: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const readers: Array<[string, string, string | null]> = [["lpkAdmin", lpk1.id, "LPK_ADMIN"], ["sensei", lpk1.id, "LPK_SENSEI"], ["tskAdmin", tsk.id, "TSK_ADMIN"], ["tskStaff", tsk.id, "TSK_STAFF"], ["superAdmin", platformOrg.id, "SUPER_ADMIN"]];
    for (const [label, org, role] of readers) {
      await actAs(tx, org, role);
      sfr[`read/${label}`] = (await tx.select().from(skillFields)).length;
      sfr[`insert/${label}`] = await attempt(tx, (t) => t.insert(skillFields).values({ code: `uji-${uniq()}`, nameId: "Uji", nameJa: "試験" }));
      sfr[`updateAll/${label}`] = (await rowsOf(tx, (t) => t.update(skillFields).set({ nameId: uniq() }).returning({ id: skillFields.id }))).n;
      sfr[`deleteAll/${label}`] = (await rowsOf(tx, (t) => t.delete(skillFields).returning({ id: skillFields.id }))).n;
    }
    await actAs(tx, "00000000-0000-0000-0000-000000000000", null);
    await tx.execute(sql`select set_config('app.org_id', '', true)`);
    sfr.readNoCtx = (await tx.select().from(skillFields)).length;
    // Sistem: tambah, kode tidak bisa diubah, bidang yang dipakai kandidat tidak bisa dihapus, yang belum dipakai bisa
    await actAsSystem(tx);
    const [fresh] = await tx.insert(skillFields).values({ code: `uji-${uniq()}`, nameId: "Uji", nameJa: "試験" }).returning();
    sfr.codeChange = await attempt(tx, (t) => t.update(skillFields).set({ code: `ubah-${uniq()}` }).where(eq(skillFields.id, fresh.id)));
    sfr.nameChange = await attempt(tx, (t) => t.update(skillFields).set({ nameJa: "更新" }).where(eq(skillFields.id, fresh.id)));
    sfr.badCode = await attempt(tx, (t) => t.insert(skillFields).values({ code: "Kode Salah!", nameId: "x", nameJa: "x" }));
    const [used] = await tx.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "food"));
    sfr.deleteUsed = await attempt(tx, (t) => t.delete(skillFields).where(eq(skillFields.id, used.id)));
    sfr.deleteFresh = (await rowsOf(tx, (t) => t.delete(skillFields).where(eq(skillFields.id, fresh.id)).returning({ id: skillFields.id }))).n;
  });
  const totalFields = (await withSystem((tx) => tx.select().from(skillFields), db)).length;
  check(
    "Bidang kerja: semua peran berkonteks membaca seluruh master; tanpa konteks 0 baris",
    ["lpkAdmin", "sensei", "tskAdmin", "tskStaff", "superAdmin"].every((l) => sfr[`read/${l}`] === totalFields) && sfr.readNoCtx === 0 && totalFields >= 6,
    `${totalFields} bidang`,
  );
  check(
    "Bidang kerja: INSERT, UPDATE dan DELETE tanpa WHERE ditolak untuk semua peran aplikasi (menulis hanya mode sistem)",
    ["lpkAdmin", "sensei", "tskAdmin", "tskStaff", "superAdmin"].every((l) => typeof sfr[`insert/${l}`] === "string" && /row-level security/i.test(String(sfr[`insert/${l}`])) && sfr[`updateAll/${l}`] === 0 && sfr[`deleteAll/${l}`] === 0),
  );
  check(
    "Bidang kerja: kode tetap (tidak bisa diubah) dan berformat huruf kecil; nama bisa diubah; bidang yang dipakai kandidat tidak bisa dihapus (FK), yang belum dipakai bisa",
    typeof sfr.codeChange === "string" && /tidak bisa diubah/.test(sfr.codeChange) && sfr.nameChange === null && typeof sfr.badCode === "string" && /check/i.test(sfr.badCode) &&
      typeof sfr.deleteUsed === "string" && /foreign key|violates/i.test(sfr.deleteUsed) && sfr.deleteFresh === 1,
    String(sfr.deleteUsed ?? ""),
  );

  // --- N. Klien (client_companies / client_sites / client_site_contacts / client_site_fields): milik TSK, LPK tidak melihat sama sekali ---
  const cl: Record<string, Record<string, unknown>> = {};
  const clientTables = [
    ["companies", clientCompanies],
    ["sites", clientSites],
    ["contacts", clientSiteContacts],
    ["siteFields", clientSiteFields],
  ] as const;
  let clientIds: { aCompany: string; aSite: string; aContact: string; bCompany: string; bSite: string; tskB: string } | null = null;
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const mkSet = async (org: string, label: string) => {
      const [co] = await tx.insert(clientCompanies).values({ orgId: org, name: `Perusahaan ${label}` }).returning();
      const [si] = await tx.insert(clientSites).values({ orgId: org, companyId: co.id, name: `Lokasi ${label}` }).returning();
      const [ct] = await tx.insert(clientSiteContacts).values({ orgId: org, siteId: si.id, name: `PIC ${label}`, phone: "000" }).returning();
      const [food] = await tx.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "food"));
      await tx.insert(clientSiteFields).values({ siteId: si.id, fieldId: food.id, orgId: org });
      return { co: co.id, si: si.id, ct: ct.id };
    };
    const a = await mkSet(tsk.id, "A");
    const b = await mkSet(tskB, "B");
    clientIds = { aCompany: a.co, aSite: a.si, aContact: a.ct, bCompany: b.co, bSite: b.si, tskB };
    // Seed demo sudah punya klien TSK A (perusahaan, lokasi, PIC, job order): jumlah milik A dihitung, bukan diasumsikan 1
    cl.aCounts = Object.fromEntries(await Promise.all(clientTables.map(async ([name, table]) => [name, (await tx.select().from(table).where(eq((table as typeof clientCompanies).orgId, tsk.id))).length]))) as Record<string, unknown>;
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const actors: Array<[string, string, string | null, string | null]> = [
      ["tskAdminA", tsk.id, "TSK_ADMIN", tskAdminUser.id],
      ["tskStaffA", tsk.id, "TSK_STAFF", staffUser.id],
      ["tskAdminB", tskB, "TSK_ADMIN", adminB],
      ["lpkAdmin", lpk1.id, "LPK_ADMIN", lpkAdminUser.id],
      ["sensei", lpk1.id, "LPK_SENSEI", lpkAdminUser.id],
      ["superAdmin", platformOrg.id, "SUPER_ADMIN", null],
      ["roleNull", tsk.id, null, null],
    ];
    const MARK = "DITANDAI-";
    for (const [who, org, role, uid] of actors) {
      cl[who] = {};
      await actAs(tx, org, role, uid);
      for (const [name, table] of clientTables) {
        cl[who][`read/${name}`] = (await tx.select().from(table)).length;
      }
      // INSERT atas nama TSK A (organisasi sesi untuk TSK; untuk peran lain dicoba memakai org TSK A)
      await scratch(tx, async (sp) => {
        await actAs(sp, org, role, uid);
        cl[who].insertCompany = await attempt(sp, (t) => t.insert(clientCompanies).values({ orgId: tsk.id, name: `Baru ${who}` }));
        cl[who].insertSite = await attempt(sp, (t) => t.insert(clientSites).values({ orgId: tsk.id, companyId: a.co, name: `Baru ${who}` }));
        cl[who].insertContact = await attempt(sp, (t) => t.insert(clientSiteContacts).values({ orgId: tsk.id, siteId: a.si, name: `Baru ${who}` }));
      }); // dibatalkan: baris uji tidak menumpuk untuk pelaku berikutnya
      // UPDATE tanpa WHERE: baris apa yang berubah (dihitung sebagai sistem)
      await scratch(tx, async (sp) => {
        await actAs(sp, org, role, uid);
        await attempt(sp, (t) => t.update(clientCompanies).set({ note: MARK + "co" }));
        await attempt(sp, (t) => t.update(clientSites).set({ note: MARK + "si" }));
        await attempt(sp, (t) => t.update(clientSiteContacts).set({ phone: MARK + "ct" }));
        await actAsSystem(sp);
        cl[who].updated = [
          ...(await sp.select({ o: clientCompanies.orgId }).from(clientCompanies).where(eq(clientCompanies.note, MARK + "co"))).map((r) => `co:${r.o}`),
          ...(await sp.select({ o: clientSites.orgId }).from(clientSites).where(eq(clientSites.note, MARK + "si"))).map((r) => `si:${r.o}`),
          ...(await sp.select({ o: clientSiteContacts.orgId }).from(clientSiteContacts).where(eq(clientSiteContacts.phone, MARK + "ct"))).map((r) => `ct:${r.o}`),
        ];
      });
      // DELETE tanpa WHERE (dalam savepoint): baris yang hilang per tabel
      for (const [name, table] of clientTables) {
        await scratch(tx, async (sp) => {
          await actAs(sp, org, role, uid);
          await attempt(sp, (t) => t.delete(table));
          await actAsSystem(sp);
          cl[who][`deleted/${name}`] = (await sp.select().from(table)).length;
        });
      }
    }
    await actAsSystem(tx);
    cl.total = Object.fromEntries(await Promise.all(clientTables.map(async ([name, table]) => [name, (await tx.select().from(table)).length])));
    // Integritas (sistem): rantai org konsisten, org_id tetap, nomor badan hukum 13 digit, pemilik harus TSK
    cl.integrity = {
      siteWrongOrg: await attempt(tx, (t) => t.insert(clientSites).values({ orgId: tskB, companyId: a.co, name: "Salah org" })),
      contactWrongOrg: await attempt(tx, (t) => t.insert(clientSiteContacts).values({ orgId: tskB, siteId: a.si, name: "Salah org" })),
      fieldWrongOrg: await attempt(tx, async (t) => {
        const [f] = await t.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "kaigo"));
        await t.insert(clientSiteFields).values({ siteId: a.si, fieldId: f.id, orgId: tskB });
      }),
      orgChange: await attempt(tx, (t) => t.update(clientCompanies).set({ orgId: tskB }).where(eq(clientCompanies.id, a.co))),
      siteMove: await attempt(tx, (t) => t.update(clientSites).set({ companyId: b.co }).where(eq(clientSites.id, a.si))),
      contactMove: await attempt(tx, (t) => t.update(clientSiteContacts).set({ siteId: b.si }).where(eq(clientSiteContacts.id, a.ct))),
      lpkOwner: await attempt(tx, (t) => t.insert(clientCompanies).values({ orgId: lpk1.id, name: "LPK tidak boleh" })),
      badNumber: await attempt(tx, (t) => t.insert(clientCompanies).values({ orgId: tsk.id, name: "x", corporateNumber: "12345" })),
      okNumber: await attempt(tx, (t) => t.insert(clientCompanies).values({ orgId: tsk.id, name: "y", corporateNumber: "1234567890123" })),
      dupField: await attempt(tx, async (t) => {
        const [f] = await t.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "food"));
        await t.insert(clientSiteFields).values({ siteId: a.si, fieldId: f.id, orgId: tsk.id });
      }),
      deleteUsedField: await attempt(tx, async (t) => {
        const [f] = await t.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "food"));
        await t.delete(skillFields).where(eq(skillFields.id, f.id));
      }),
    };
  });
  const noAccess = ["lpkAdmin", "sensei", "superAdmin", "roleNull"];
  const aC = cl.aCounts as Record<string, number>;
  const rowsOk = (who: string, expectRead: Record<string, number>) => clientTables.every(([n]) => cl[who][`read/${n}`] === expectRead[n]);
  const own1 = { companies: 1, sites: 1, contacts: 1, siteFields: 1 };
  const none4 = { companies: 0, sites: 0, contacts: 0, siteFields: 0 };
  check(
    "Klien: LPK_ADMIN, sensei, super admin (jalur aplikasi) dan peran null tidak bisa SELECT satu baris pun; TSK hanya melihat milik organisasinya (A dan B terpisah)",
    noAccess.every((w) => rowsOk(w, none4)) && rowsOk("tskAdminA", aC) && rowsOk("tskStaffA", aC) && rowsOk("tskAdminB", own1) && aC.companies > 1,
    JSON.stringify(Object.fromEntries(["tskAdminA", "tskAdminB", "lpkAdmin"].map((w) => [w, clientTables.map(([n]) => cl[w][`read/${n}`]).join("/")]))),
  );
  check(
    "Klien: INSERT ditolak untuk LPK, sensei, super admin, peran null, dan TSK lain; diterima untuk TSK_ADMIN dan TSK_STAFF pemilik",
    noAccess.concat(["tskAdminB"]).every((w) => ["insertCompany", "insertSite", "insertContact"].every((k) => typeof cl[w][k] === "string" && /row-level security|tidak bisa|harus milik|hanya boleh dimiliki/i.test(String(cl[w][k])))) &&
      ["tskAdminA", "tskStaffA"].every((w) => ["insertCompany", "insertSite", "insertContact"].every((k) => cl[w][k] === null)),
  );
  const ownerEnd = (id: string) => (arr: unknown, n: number) => Array.isArray(arr) && arr.length === n && arr.every((x) => String(x).endsWith(id));
  check(
    "Klien: UPDATE tanpa WHERE hanya mengenai baris milik TSK yang bersangkutan (LPK, sensei, super admin, peran null tidak sama sekali; TSK B tidak menyentuh A)",
    noAccess.every((w) => (cl[w].updated as unknown[]).length === 0) &&
      ownerEnd(tsk.id)(cl.tskAdminA.updated, aC.companies + aC.sites + aC.contacts) && ownerEnd(tsk.id)(cl.tskStaffA.updated, aC.companies + aC.sites + aC.contacts) &&
      ownerEnd(clientIds!.tskB)(cl.tskAdminB.updated, 3),
  );
  const tot = cl.total as Record<string, number>;
  check(
    "Klien: DELETE tanpa WHERE: TSK_STAFF tidak menghapus perusahaan, lokasi, maupun PIC (hanya baris bidang lokasi); TSK_ADMIN hanya milik TSK-nya, dan perusahaan/lokasi yang punya job order tidak terhapus (FK RESTRICT); LPK, sensei, super admin, peran null tidak sama sekali",
    noAccess.every((w) => clientTables.every(([n]) => cl[w][`deleted/${n}`] === tot[n])) &&
      cl.tskStaffA["deleted/companies"] === tot.companies && cl.tskStaffA["deleted/sites"] === tot.sites && cl.tskStaffA["deleted/contacts"] === tot.contacts && cl.tskStaffA["deleted/siteFields"] === tot.siteFields - aC.siteFields &&
      cl.tskAdminA["deleted/companies"] === tot.companies && cl.tskAdminA["deleted/sites"] === tot.sites && // ditolak FK: A punya job order (seed)
      cl.tskAdminA["deleted/contacts"] === tot.contacts - aC.contacts && cl.tskAdminA["deleted/siteFields"] === tot.siteFields - aC.siteFields &&
      clientTables.every(([n]) => cl.tskAdminB[`deleted/${n}`] === tot[n] - 1), // B tidak punya job order: terhapus semua (miliknya)
    JSON.stringify(Object.fromEntries(["tskStaffA", "tskAdminA", "tskAdminB"].map((w) => [w, clientTables.map(([n]) => `${n}:${cl[w][`deleted/${n}`]}/${tot[n]}`).join(" ")]))),
  );
  const ig = cl.integrity as Record<string, string | null>;
  check(
    "Klien: rantai org_id konsisten dan tidak bisa diubah/dipindah; pemilik harus TSK; nomor badan hukum 13 digit; bidang ganda ditolak; bidang yang dipakai lokasi tidak bisa dihapus",
    ["siteWrongOrg", "contactWrongOrg", "fieldWrongOrg", "orgChange", "siteMove", "contactMove", "lpkOwner", "badNumber", "dupField", "deleteUsedField"].every((k) => typeof ig[k] === "string") &&
      ig.okNumber === null && /tidak bisa diganti/.test(String(ig.orgChange)) && /tidak bisa dipindah/.test(String(ig.siteMove)) && /hanya boleh dimiliki organisasi TSK/.test(String(ig.lpkOwner)) &&
      /client_companies_corporate_number_check/.test(String(ig.badNumber)) && /foreign key|violates/i.test(String(ig.deleteUsedField)),
    JSON.stringify(Object.fromEntries(Object.entries(ig).map(([k, v]) => [k, v === null ? "ok" : String(v).slice(0, 40)]))),
  );

  // --- O. Job order, seleksi per job order, dan penempatan ---
  const jr: Record<string, Record<string, unknown>> = {};
  const jx: Record<string, unknown> = {};
  let tskBId = "";
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    tskBId = tskB;
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const aJo = await newJobOrder(tx, tsk.id);
    const bJo = await newJobOrder(tx, tskB);
    const fresh = await newJobOrder(tx, tsk.id); // tidak dirujuk apa pun: boleh dihapus TSK_ADMIN
    const [aSiteRow] = await tx.select({ s: jobOrders.siteId }).from(jobOrders).where(eq(jobOrders.id, aJo));
    // Penempatan uji untuk TSK A dan B (ENDED supaya tidak mengganggu aturan ACTIVE; sebagai sistem)
    const [candA] = await tx.select({ id: candidates.id }).from(candidates).where(eq(candidates.id, studying1.id));
    const [bSiteRow] = await tx.select({ s: jobOrders.siteId }).from(jobOrders).where(eq(jobOrders.id, bJo));
    await tx.insert(placements).values([
      { candidateId: candA.id, orgId: tsk.id, siteId: aSiteRow.s, jobOrderId: aJo, startDate: "2020-01-01", endDate: "2020-12-31", status: "ENDED" },
      { candidateId: candA.id, orgId: tskB, siteId: bSiteRow.s, jobOrderId: bJo, startDate: "2020-01-01", endDate: "2020-12-31", status: "ENDED" },
    ]);
    const actors: Array<[string, string, string | null, string | null]> = [
      ["tskAdminA", tsk.id, "TSK_ADMIN", tskAdminUser.id],
      ["tskStaffA", tsk.id, "TSK_STAFF", staffUser.id],
      ["tskAdminB", tskB, "TSK_ADMIN", adminB],
      ["lpkAdmin", lpk1.id, "LPK_ADMIN", lpkAdminUser.id],
      ["sensei", lpk1.id, "LPK_SENSEI", lpkAdminUser.id],
      ["superAdmin", platformOrg.id, "SUPER_ADMIN", null],
      ["roleNull", tsk.id, null, null],
    ];
    const MARK = "DITANDAI-JO";
    for (const [who, org, role, uid] of actors) {
      jr[who] = {};
      await actAs(tx, org, role, uid);
      jr[who].readJo = (await tx.select().from(jobOrders)).length;
      jr[who].readPl = (await tx.select().from(placements)).length;
      jr[who].readView = (await tx.select().from(candidateHeadlineDecision)).length;
      await scratch(tx, async (sp) => {
        await actAs(sp, org, role, uid);
        jr[who].insertJo = await attempt(sp, async (t) => {
          await t.insert(jobOrders).values({ orgId: tsk.id, siteId: aSiteRow.s, fieldId: (await t.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "food")))[0].id, title: `Baru ${who}`, positions: 1 });
        });
        jr[who].insertPl = await attempt(sp, (t) => t.insert(placements).values({ candidateId: candA.id, orgId: tsk.id, siteId: aSiteRow.s, startDate: "2021-01-01", endDate: "2021-02-01", status: "ENDED" }));
        await attempt(sp, (t) => t.update(jobOrders).set({ note: MARK }));
        await attempt(sp, (t) => t.update(placements).set({ note: MARK }));
        await actAsSystem(sp);
        jr[who].updatedJo = (await sp.select({ o: jobOrders.orgId }).from(jobOrders).where(eq(jobOrders.note, MARK))).map((r) => r.o);
        jr[who].updatedPl = (await sp.select({ o: placements.orgId }).from(placements).where(eq(placements.note, MARK))).map((r) => r.o);
      });
      await scratch(tx, async (sp) => {
        await actAs(sp, org, role, uid);
        jr[who].deleteFresh = (await rowsOf(sp, (t) => t.delete(jobOrders).where(eq(jobOrders.id, fresh)).returning({ id: jobOrders.id }))).n;
        jr[who].deletePlAll = (await rowsOf(sp, (t) => t.delete(placements).returning({ id: placements.id }))).n;
        jr[who].deleteJoAll = await attempt(sp, (t) => t.delete(jobOrders)); // seed: job order dirujuk seleksi -> admin A ditolak FK; B bersih
        await actAsSystem(sp);
        jr[who].joLeft = (await sp.select().from(jobOrders)).length;
      });
    }
    await actAsSystem(tx);
    jx.totalJo = (await tx.select().from(jobOrders)).length;
    jx.totalPl = (await tx.select().from(placements)).length;
    jx.aJoCount = (await tx.select().from(jobOrders).where(eq(jobOrders.orgId, tsk.id))).length;
    jx.aPlCount = (await tx.select().from(placements).where(eq(placements.orgId, tsk.id))).length;

    // ---- Aturan job_order_id pada seleksi (kandidat uji: studying1; sebagai sistem)
    const cand = studying1.id;
    const clearSel = async () => {
      await tx.execute(sql`reset role`);
      await tx.execute(sql`delete from placements where candidate_id = ${cand} and status = 'ACTIVE'`);
      await tx.execute(sql`delete from candidate_selections where candidate_id = ${cand}`);
      await tx.execute(sql`set local role hashi_app`);
      await actAsSystem(tx);
    };
    await clearSel();
    for (const d of selectionDecision.enumValues) {
      await clearSel();
      jx[`noJo/${d}`] = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: cand, tskOrgId: tsk.id, decision: d }));
    }
    await clearSel();
    jx.otherTskJo = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: cand, tskOrgId: tsk.id, decision: "SUBMITTED_TO_CLIENT", jobOrderId: bJo }));
    jx.firstGeneral = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: cand, tskOrgId: tsk.id, decision: "SHORTLISTED" }));
    jx.secondGeneral = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: cand, tskOrgId: tsk.id, decision: "NONE" }));
    jx.perJo1 = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: cand, tskOrgId: tsk.id, decision: "SUBMITTED_TO_CLIENT", jobOrderId: aJo }));
    jx.perJoDup = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: cand, tskOrgId: tsk.id, decision: "REJECTED", jobOrderId: aJo }));
    const jo2 = await newJobOrder(tx, tsk.id);
    jx.perJo2 = await attempt(tx, (t) => t.insert(candidateSelections).values({ candidateId: cand, tskOrgId: tsk.id, decision: "SUBMITTED_TO_CLIENT", jobOrderId: jo2 }));
    jx.moveJo = await attempt(tx, (t) => t.update(candidateSelections).set({ jobOrderId: jo2 }).where(and(eq(candidateSelections.candidateId, cand), eq(candidateSelections.jobOrderId, aJo))));
    jx.headline = (await tx.select().from(candidateHeadlineDecision).where(and(eq(candidateHeadlineDecision.candidateId, cand), eq(candidateHeadlineDecision.tskOrgId, tsk.id)))).map((r) => r.decision);

    // ---- DEPARTED membuat penempatan ACTIVE; satu ACTIVE per kandidat
    await tx.update(candidateSelections).set({ decision: "DEPARTED" }).where(and(eq(candidateSelections.candidateId, cand), eq(candidateSelections.jobOrderId, aJo)));
    const active = await tx.select().from(placements).where(and(eq(placements.candidateId, cand), eq(placements.status, "ACTIVE")));
    jx.activeCount = active.length;
    jx.activeSite = active[0]?.siteId === aSiteRow.s && active[0]?.jobOrderId === aJo && active[0]?.orgId === tsk.id;
    jx.departedAgain = await attempt(tx, (t) => t.update(candidateSelections).set({ decision: "DEPARTED" }).where(and(eq(candidateSelections.candidateId, cand), eq(candidateSelections.jobOrderId, jo2))));
    jx.dupActive = await attempt(tx, (t) => t.insert(placements).values({ candidateId: cand, orgId: tsk.id, siteId: aSiteRow.s, startDate: "2022-01-01" }));
    jx.endNoDate = await attempt(tx, (t) => t.update(placements).set({ status: "ENDED" }).where(eq(placements.id, active[0].id)));
    jx.endOk = await attempt(tx, (t) => t.update(placements).set({ status: "ENDED", endDate: "2030-01-01" }).where(eq(placements.id, active[0].id)));
    const [otherCand] = await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.organizationId, lpk1.id), ne(candidates.id, cand))).limit(1);
    jx.moveSite = await attempt(tx, (t) => t.update(placements).set({ candidateId: otherCand.id }).where(eq(placements.id, active[0].id)));
    jx.newActiveAfterEnd = await attempt(tx, (t) => t.insert(placements).values({ candidateId: cand, orgId: tsk.id, siteId: aSiteRow.s, startDate: "2031-01-01" }));

    // ---- Auto FILLED (OPEN -> FILLED bila terpilih >= posisi), dibuka manual tidak dibalik otomatis
    await clearSel();
    const fillJo = await newJobOrder(tx, tsk.id);
    await tx.update(jobOrders).set({ positions: 2 }).where(eq(jobOrders.id, fillJo));
    const cands = (await tx.select({ id: candidates.id }).from(candidates).where(eq(candidates.organizationId, lpk1.id)).limit(3)).map((c) => c.id);
    const statusOf = async () => (await tx.select({ s: jobOrders.status }).from(jobOrders).where(eq(jobOrders.id, fillJo)))[0].s;
    await tx.insert(candidateSelections).values({ candidateId: cands[0], tskOrgId: tsk.id, decision: "PASSED_CLIENT_INTERVIEW", jobOrderId: fillJo });
    jx.fill1 = await statusOf();
    await tx.insert(candidateSelections).values({ candidateId: cands[1], tskOrgId: tsk.id, decision: "SUBMITTED_TO_CLIENT", jobOrderId: fillJo });
    jx.fillSubmitted = await statusOf();
    await tx.update(candidateSelections).set({ decision: "DOCUMENT_PROCESS" }).where(and(eq(candidateSelections.candidateId, cands[1]), eq(candidateSelections.jobOrderId, fillJo)));
    jx.fill2 = await statusOf();
    await tx.update(jobOrders).set({ status: "OPEN" }).where(eq(jobOrders.id, fillJo));
    jx.reopened = await statusOf(); // dibuka manual: tetap OPEN walau penuh
    await tx.update(candidateSelections).set({ decision: "PASSED_CLIENT_INTERVIEW" }).where(and(eq(candidateSelections.candidateId, cands[1]), eq(candidateSelections.jobOrderId, fillJo)));
    jx.fillAgain = await statusOf();
    await tx.update(jobOrders).set({ status: "CLOSED" }).where(eq(jobOrders.id, fillJo));
    await tx.update(candidateSelections).set({ decision: "DOCUMENT_PROCESS" }).where(and(eq(candidateSelections.candidateId, cands[1]), eq(candidateSelections.jobOrderId, fillJo)));
    jx.closedStays = await statusOf(); // CLOSED tidak pernah berubah otomatis
    await tx.update(jobOrders).set({ status: "OPEN", positions: 1 }).where(eq(jobOrders.id, fillJo));
    jx.positionsDown = await statusOf(); // posisi diturunkan sambil OPEN: terpilih 2 >= 1 -> FILLED

    // ---- Penjaga job order: bidang harus diterima lokasi; lokasi/organisasi tidak bisa diganti
    const [agri] = await tx.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "agri"));
    jx.fieldNotAccepted = await attempt(tx, (t) => t.update(jobOrders).set({ fieldId: agri.id }).where(eq(jobOrders.id, aJo)));
    jx.siteChange = await attempt(tx, (t) => t.update(jobOrders).set({ siteId: bSiteRow.s }).where(eq(jobOrders.id, aJo)));
    jx.orgChange = await attempt(tx, (t) => t.update(jobOrders).set({ orgId: tskB }).where(eq(jobOrders.id, aJo)));
    jx.badPositions = await attempt(tx, (t) => t.update(jobOrders).set({ positions: 0 }).where(eq(jobOrders.id, aJo)));
    jx.badJlpt = await attempt(tx, (t) => t.update(jobOrders).set({ minJlpt: "N9" }).where(eq(jobOrders.id, aJo)));
    // Site/perusahaan yang punya job order tidak bisa dihapus (FK RESTRICT)
    jx.deleteSiteWithJo = await attempt(tx, (t) => t.delete(clientSites).where(eq(clientSites.id, aSiteRow.s)));
    jx.deleteJoWithSelection = await attempt(tx, (t) => t.delete(jobOrders).where(eq(jobOrders.id, aJo)));
    // View keputusan paling maju: tidak memuat job_order_id, dan LPK hanya melihat kandidatnya
    const cols = await tx.execute(sql`select column_name from information_schema.columns where table_name = 'candidate_headline_decision' order by ordinal_position`);
    jx.viewCols = cols.rows.map((r) => String(r.column_name));
  });
  const JA = "tskAdminA", JS = "tskStaffA", JB = "tskAdminB";
  const lpkLike = ["lpkAdmin", "sensei", "superAdmin", "roleNull"];
  check(
    "Job order & penempatan: LPK_ADMIN, sensei, super admin (jalur aplikasi) dan peran null tidak bisa SELECT satu baris pun; TSK hanya melihat milik organisasinya",
    lpkLike.every((w) => jr[w].readJo === 0 && jr[w].readPl === 0) && jr[JA].readJo === jx.aJoCount && jr[JS].readJo === jx.aJoCount && jr[JA].readPl === jx.aPlCount && jr[JB].readJo === 1 && jr[JB].readPl === 1,
    `A: ${jr[JA].readJo}/${jr[JA].readPl}, B: ${jr[JB].readJo}/${jr[JB].readPl}`,
  );
  check(
    "Job order & penempatan: INSERT ditolak untuk LPK, sensei, super admin, peran null, dan TSK lain; job order boleh dibuat TSK_ADMIN/TSK_STAFF pemilik; penempatan tidak bisa dibuat TSK (hanya trigger)",
    lpkLike.concat([JB]).every((w) => typeof jr[w].insertJo === "string") && [JA, JS].every((w) => jr[w].insertJo === null) &&
      lpkLike.concat([JA, JS, JB]).every((w) => typeof jr[w].insertPl === "string" && /row-level security/i.test(String(jr[w].insertPl))),
  );
  const only = (arr: unknown, org: string) => Array.isArray(arr) && arr.length > 0 && arr.every((o) => o === org);
  check(
    "Job order & penempatan: UPDATE tanpa WHERE hanya mengenai baris milik TSK bersangkutan (LPK, sensei, super admin, peran null tidak sama sekali)",
    lpkLike.every((w) => (jr[w].updatedJo as unknown[]).length === 0 && (jr[w].updatedPl as unknown[]).length === 0) &&
      only(jr[JA].updatedJo, tsk.id) && only(jr[JS].updatedJo, tsk.id) && only(jr[JA].updatedPl, tsk.id) && only(jr[JB].updatedJo, tskBId) &&
      (jr[JA].updatedJo as unknown[]).length === (jx.aJoCount as number) + 1 && (jr[JS].updatedJo as unknown[]).length === (jx.aJoCount as number) + 1, // +1: job order yang baru dibuat TSK pemilik di savepoint yang sama
    JSON.stringify([lpkLike.map((w) => [(jr[w].updatedJo as unknown[]).length, (jr[w].updatedPl as unknown[]).length]), (jr[JA].updatedJo as unknown[]).length, jx.aJoCount, (jr[JA].updatedPl as unknown[]).length, (jr[JB].updatedJo as unknown[]).length, String(jr[JA].insertJo).slice(0, 80)]),
  );
  check(
    "Job order & penempatan: DELETE: TSK_STAFF tidak bisa menghapus job order; TSK_ADMIN hanya yang miliknya dan belum dirujuk (FK RESTRICT menahan sisanya); penempatan tidak bisa dihapus siapa pun; LPK/sensei/super admin/peran null tidak sama sekali",
    lpkLike.every((w) => jr[w].deleteFresh === 0 && jr[w].deletePlAll === 0 && jr[w].joLeft === jx.totalJo) && jr[JS].deleteFresh === 0 && jr[JS].joLeft === jx.totalJo &&
      jr[JA].deleteFresh === 1 && jr[JB].deleteFresh === 0 && [JA, JB].every((w) => typeof jr[w].deleteJoAll === "string" && /foreign key|violates/i.test(String(jr[w].deleteJoAll))) && // dirujuk seleksi (A) / penempatan (B)
      jr[JB].joLeft === jx.totalJo &&
      [JA, JS, JB].every((w) => jr[w].deletePlAll === 0),
    `A hapus bebas: ${jr[JA].deleteFresh}, A hapus semua: ${String(jr[JA].deleteJoAll).slice(0, 60)}`,
  );
  const needs = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"];
  check(
    "Seleksi: PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, dan DEPARTED WAJIB punya job order (CHECK); keputusan lain boleh umum",
    selectionDecision.enumValues.every((d) => (needs.includes(d) ? /candidate_selections_job_order_required/.test(String(jx[`noJo/${d}`])) : jx[`noJo/${d}`] === null)),
    selectionDecision.enumValues.map((d) => `${d}:${jx[`noJo/${d}`] === null ? "ok" : "tolak"}`).join(" "),
  );
  check(
    "Seleksi per job order: job order milik TSK lain ditolak; satu baris umum + satu per job order (NULL dihitung sama); duplikat ditolak; job order tidak bisa dipindah; keputusan paling maju menjadi headline",
    typeof jx.otherTskJo === "string" && /harus milik TSK yang sama/.test(String(jx.otherTskJo)) && jx.firstGeneral === null && /unique|duplicate/i.test(String(jx.secondGeneral)) &&
      jx.perJo1 === null && /unique|duplicate/i.test(String(jx.perJoDup)) && jx.perJo2 === null && /tidak bisa dipindahkan/.test(String(jx.moveJo)) && JSON.stringify(jx.headline) === JSON.stringify(["SUBMITTED_TO_CLIENT"]),
    `${String(jx.secondGeneral).slice(0, 50)} | ${JSON.stringify(jx.headline)}`,
  );
  check(
    "Penempatan: keputusan DEPARTED membuat penempatan ACTIVE (lokasi, job order, TSK dari job order); DEPARTED kedua saat sudah ada ACTIVE ditolak; maksimal satu ACTIVE per kandidat; selesai wajib tanggal; identitas tidak bisa diganti",
    jx.activeCount === 1 && jx.activeSite === true && /penempatan aktif/.test(String(jx.departedAgain)) && /placements_one_active_key|unique/i.test(String(jx.dupActive)) &&
      /placements_ended_check/.test(String(jx.endNoDate)) && jx.endOk === null && /tidak bisa diganti/.test(String(jx.moveSite)) && jx.newActiveAfterEnd === null,
    JSON.stringify([jx.activeCount, jx.activeSite, String(jx.departedAgain).slice(0, 60), String(jx.dupActive).slice(0, 60), String(jx.endNoDate).slice(0, 70), jx.endOk, String(jx.moveSite).slice(0, 60), jx.newActiveAfterEnd]),
  );
  check(
    "Job order terisi otomatis: OPEN -> FILLED hanya saat terpilih (PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED) >= posisi; diajukan saja tidak menghitung; dibuka manual tidak dibalik sampai seleksi berubah lagi; CLOSED tidak berubah; posisi diturunkan menghitung ulang",
    jx.fill1 === "OPEN" && jx.fillSubmitted === "OPEN" && jx.fill2 === "FILLED" && jx.reopened === "OPEN" && jx.fillAgain === "FILLED" && jx.closedStays === "CLOSED" && jx.positionsDown === "FILLED",
    [jx.fill1, jx.fillSubmitted, jx.fill2, jx.reopened, jx.fillAgain, jx.closedStays, jx.positionsDown].join(" > "),
  );
  check(
    "Penjaga job order: bidang harus diterima lokasi; lokasi dan organisasi tidak bisa diganti; posisi >= 1; level JLPT valid; lokasi/job order yang dirujuk tidak bisa dihapus (FK RESTRICT)",
    /bidang job order/.test(String(jx.fieldNotAccepted)) && /tidak bisa diganti/.test(String(jx.siteChange)) && /tidak bisa diganti/.test(String(jx.orgChange)) &&
      /job_orders_positions_check/.test(String(jx.badPositions)) && /job_orders_min_jlpt_check/.test(String(jx.badJlpt)) &&
      /foreign key|violates/i.test(String(jx.deleteSiteWithJo)) && /foreign key|violates/i.test(String(jx.deleteJoWithSelection)),
  );
  check(
    "View keputusan paling maju (dipakai LPK) tidak memuat job order; LPK_ADMIN hanya melihat keputusan kandidat miliknya, TSK lain tidak melihat milik TSK ini",
    JSON.stringify(jx.viewCols) === JSON.stringify(["candidate_id", "tsk_org_id", "decision", "decided_at"]) && jr[JB].readView === 0 && (jr[JA].readView as number) > 0 && jr.sensei.readView !== undefined,
    `${JSON.stringify(jx.viewCols)} A=${jr[JA].readView} B=${jr[JB].readView} LPK=${jr.lpkAdmin.readView}`,
  );

  // --- P. Semua VIEW di schema public harus security_invoker; SELECT langsung ke view keputusan paling maju per peran ---
  const vw: Record<string, unknown> = {};
  const RANK: Record<string, number> = { NONE: 0, REJECTED: 1, SHORTLISTED: 2, PASSED_TSK_INTERVIEW: 3, SUBMITTED_TO_CLIENT: 4, PASSED_CLIENT_INTERVIEW: 5, DOCUMENT_PROCESS: 6, DEPARTED: 7 }; // salinan eksplisit selection_decision_rank
  await sandbox(async (tx) => {
    // Semua view/materialized view: wajib security_invoker=true (view tanpa itu berjalan sebagai owner dan melewati RLS)
    const views = await tx.execute(sql`select c.relname, c.relkind, coalesce(c.reloptions::text, '{}') as opts from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm') order by 1`);
    vw.views = views.rows.map((r) => `${r.relname}:${r.relkind}:${r.opts}`);
    vw.insecure = views.rows.filter((r) => r.relkind === "m" || !/security_invoker=(true|on)/.test(String(r.opts))).map((r) => String(r.relname));

    const tskB = await makeTskB(tx); // mitra LPK Bandung, hanya punya keputusan di kandidat uji ini
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    await decide(tx, studying1.id, tsk.id, "SHORTLISTED");
    await decide(tx, studying1.id, tskB, "SHORTLISTED");
    await decide(tx, ready1.id, tsk.id, "PASSED_CLIENT_INTERVIEW"); // dengan job order: headline mengalahkan baris umum
    await tx.insert(candidateSelections).values({ candidateId: ready1.id, tskOrgId: tsk.id, decision: "REJECTED" });
    await actAsSystem(tx);

    // Harapan dihitung dari tabel dasar (sebagai sistem) dengan aturan terlihat per peran, bukan dari view
    const base = await tx.select().from(candidateSelections);
    const candOrg = new Map((await tx.select({ id: candidates.id, o: candidates.organizationId, sh: candidates.sharedWithTsk }).from(candidates)).map((c) => [c.id, c]));
    const best = new Map<string, { cand: string; tsk: string; decision: string }>();
    for (const r of base) {
      const k = `${r.candidateId}|${r.tskOrgId}`;
      if (!best.has(k) || RANK[r.decision] > RANK[best.get(k)!.decision]) best.set(k, { cand: r.candidateId, tsk: r.tskOrgId, decision: r.decision });
    }
    const partners = new Set((await tx.select().from(partnerships)).filter((p) => p.active).map((p) => `${p.lpkId}|${p.tskId}`));
    const want = (pred: (b: { cand: string; tsk: string }) => boolean) => [...best.values()].filter(pred).map((b) => `${b.cand}|${b.tsk}|${b.decision}`).sort();
    const lpkRows = (org: string) => want((b) => candOrg.get(b.cand)?.o === org);
    const tskRows = (org: string) => want((b) => b.tsk === org && !!candOrg.get(b.cand)?.sh && partners.has(`${candOrg.get(b.cand)!.o}|${org}`));
    const read = async (org: string, role: string | null, uid: string | null) => {
      await actAs(tx, org, role, uid);
      return (await tx.select().from(candidateHeadlineDecision)).map((r) => `${r.candidateId}|${r.tskOrgId}|${r.decision}`).sort();
    };
    const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
    vw.lpkAdmin = same(await read(lpk1.id, "LPK_ADMIN", lpkAdminUser.id), lpkRows(lpk1.id));
    vw.lpkAdminN = lpkRows(lpk1.id).length;
    vw.sensei = same(await read(lpk1.id, "LPK_SENSEI", lpkAdminUser.id), lpkRows(lpk1.id)); // sensei boleh membaca keputusan (bukan catatan)
    vw.lpk2 = same(await read(lpk2.id, "LPK_ADMIN", null), lpkRows(lpk2.id));
    vw.lpk3 = same(await read(lpk3.id, "LPK_ADMIN", null), lpkRows(lpk3.id)) && (await read(lpk3.id, "LPK_ADMIN", null)).length === 0 === (lpkRows(lpk3.id).length === 0);
    vw.tskA = same(await read(tsk.id, "TSK_ADMIN", tskAdminUser.id), tskRows(tsk.id));
    vw.tskB = same(await read(tskB, "TSK_ADMIN", adminB), tskRows(tskB));
    vw.tskBN = tskRows(tskB).length;
    const bRows = await read(tskB, "TSK_ADMIN", adminB);
    vw.tskBOnlyOwn = bRows.length > 0 && bRows.every((r) => !r.includes(`|${tsk.id}|`));
    vw.roleNull = (await read(tsk.id, null, null)).length;
    vw.superAdmin = (await read(platformOrg.id, "SUPER_ADMIN", null)).length;
    await actAs(tx, "00000000-0000-0000-0000-000000000000", null);
    await tx.execute(sql`select set_config('app.org_id', '', true)`);
    vw.noContext = (await tx.select().from(candidateHeadlineDecision)).length;
    // Headline = keputusan paling maju: ready1 punya baris REJECTED (umum) + PASSED_CLIENT_INTERVIEW (job order) -> PASSED_CLIENT_INTERVIEW
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    vw.headline = (await tx.select().from(candidateHeadlineDecision).where(eq(candidateHeadlineDecision.candidateId, ready1.id))).map((r) => r.decision);
  });
  check(
    "View: semua view/materialized view di schema public memakai security_invoker=true (RLS tabel dasar berlaku bagi pemanggil)",
    (vw.insecure as string[]).length === 0 && (vw.views as string[]).length >= 1,
    (vw.views as string[]).join(", "),
  );
  check(
    "View candidate_headline_decision (SELECT langsung): LPK_ADMIN dan sensei hanya keputusan kandidat LPK-nya; LPK lain hanya miliknya; TSK lain hanya baris TSK-nya sendiri; tanpa konteks/peran null/super admin 0 baris",
    vw.lpkAdmin === true && vw.sensei === true && vw.lpk2 === true && vw.lpk3 === true && vw.tskA === true && vw.tskB === true && vw.tskBOnlyOwn === true &&
      (vw.lpkAdminN as number) > 0 && (vw.tskBN as number) > 0 && vw.noContext === 0 && vw.roleNull === 0 && vw.superAdmin === 0,
    JSON.stringify(vw),
  );
  check("View candidate_headline_decision: keputusan paling maju menang atas baris umum dan REJECTED", JSON.stringify(vw.headline) === JSON.stringify(["PASSED_CLIENT_INTERVIEW"]), JSON.stringify(vw.headline));

  // --- Q. Tata letak dashboard (user_dashboard_layouts): milik sendiri, tanpa akses lintas pengguna/organisasi ---
  const dl: Record<string, unknown> = {};
  const layoutOk = JSON.stringify({ v: 1, items: [{ id: "stage-bar", size: "full" }] });
  await sandbox(async (tx) => {
    const uA = allUsers.find((u) => u.role === "LPK_ADMIN" && u.organizationId === lpk1.id)!;
    const uS = allUsers.find((u) => u.role === "LPK_SENSEI" && u.organizationId === lpk1.id)!;
    const uB = allUsers.find((u) => u.role === "LPK_ADMIN" && u.organizationId === lpk2.id)!;
    const ins = (userId: string, orgId: string, layout: string) => tx.execute(sql`insert into user_dashboard_layouts (user_id, org_id, layout) values (${userId}::uuid, ${orgId}::uuid, ${layout}::jsonb)`);
    await actAs(tx, lpk1.id, "LPK_ADMIN", uA.id);
    dl.insertOwn = await attempt(tx, () => ins(uA.id, lpk1.id, layoutOk));
    dl.insertOtherUser = await attempt(tx, () => ins(uS.id, lpk1.id, layoutOk)); // atas nama pengguna lain
    dl.insertOtherOrg = await attempt(tx, () => ins(uA.id, lpk2.id, layoutOk)); // organisasi bukan miliknya (sudah ada baris: konflik atau policy)
    dl.readOwn = (await tx.execute(sql`select user_id from user_dashboard_layouts`)).rows.length;
    // sensei yang satu organisasi (bahkan admin tak boleh melihat milik orang lain): SELECT / UPDATE / DELETE TANPA WHERE
    await actAs(tx, lpk1.id, "LPK_SENSEI", uS.id);
    dl.senseiSees = (await tx.execute(sql`select user_id from user_dashboard_layouts`)).rows.length;
    dl.senseiUpdate = (await tx.execute(sql`update user_dashboard_layouts set layout = '{"v":1,"items":[]}'::jsonb returning user_id`)).rows.length;
    dl.senseiDelete = (await tx.execute(sql`delete from user_dashboard_layouts returning user_id`)).rows.length;
    dl.senseiInsertOwn = await attempt(tx, () => ins(uS.id, lpk1.id, layoutOk));
    // organisasi lain, tanpa konteks pengguna, peran null, super admin (jalur aplikasi: org platform)
    await actAs(tx, lpk2.id, "LPK_ADMIN", uB.id);
    dl.otherOrgSees = (await tx.execute(sql`select user_id from user_dashboard_layouts`)).rows.length;
    await actAs(tx, lpk1.id, "LPK_ADMIN", null);
    dl.noUserSees = (await tx.execute(sql`select user_id from user_dashboard_layouts`)).rows.length; // org benar, user_id kosong
    dl.noUserInsert = await attempt(tx, () => ins(uA.id, lpk1.id, layoutOk));
    await actAs(tx, lpk1.id, null, uA.id);
    dl.roleNullOwn = (await tx.execute(sql`select user_id from user_dashboard_layouts where user_id = ${uA.id}::uuid`)).rows.length; // peran tak dipakai: milik sendiri tetap terbaca
    await tx.execute(sql`select set_config('app.org_id', '', true), set_config('app.role', '', true), set_config('app.user_id', '', true), set_config('app.bypass_rls', 'off', true)`);
    dl.noContextSees = (await tx.execute(sql`select user_id from user_dashboard_layouts`)).rows.length;
    // pemilik: ubah isi boleh, ganti pemilik/organisasi tidak
    await actAs(tx, lpk1.id, "LPK_ADMIN", uA.id);
    dl.updateOwn = await attempt(tx, () => tx.execute(sql`update user_dashboard_layouts set layout = '{"v":1,"items":[]}'::jsonb`));
    dl.moveOwner = await attempt(tx, () => tx.execute(sql`update user_dashboard_layouts set user_id = ${uS.id}::uuid`));
    dl.moveOrg = await attempt(tx, () => tx.execute(sql`update user_dashboard_layouts set org_id = ${lpk2.id}::uuid`));
    // batasan isi
    await actAs(tx, lpk1.id, "LPK_SENSEI", uS.id);
    dl.notObject = await attempt(tx, () => ins(uS.id, lpk1.id, "[1,2]"));
    dl.tooBig = await attempt(tx, () => ins(uS.id, lpk1.id, JSON.stringify({ v: 1, pad: "x".repeat(4100) })));
    // pemilik menghapus miliknya; hapus pengguna menghapus barisnya (cascade)
    await actAs(tx, lpk1.id, "LPK_ADMIN", uA.id);
    dl.deleteOwn = (await tx.execute(sql`delete from user_dashboard_layouts returning user_id`)).rows.length;
    await actAsSystem(tx); // baris sensei sudah ada dari senseiInsertOwn
    await tx.execute(sql`delete from users where id = ${uS.id}::uuid`);
    dl.cascade = (await tx.execute(sql`select user_id from user_dashboard_layouts where user_id = ${uS.id}::uuid`)).rows.length;
  });
  check(
    "Tata letak dashboard: pemilik menyimpan/membaca/mengubah/menghapus miliknya; atas nama pengguna lain atau organisasi lain ditolak",
    dl.insertOwn === null && dl.insertOtherUser !== null && dl.insertOtherOrg !== null && dl.readOwn === 1 && dl.updateOwn === null && dl.deleteOwn === 1 && dl.roleNullOwn === 1,
    JSON.stringify([dl.insertOwn, String(dl.insertOtherUser).slice(0, 50), String(dl.insertOtherOrg).slice(0, 50), dl.readOwn, dl.updateOwn, dl.deleteOwn, dl.roleNullOwn]),
  );
  check(
    "Tata letak dashboard: pengguna lain di organisasi yang sama (sensei), organisasi lain, tanpa pengguna, dan tanpa konteks tidak melihat/mengubah/menghapus baris orang lain (SELECT/UPDATE/DELETE tanpa WHERE = 0 baris)",
    dl.senseiSees === 0 && dl.senseiUpdate === 0 && dl.senseiDelete === 0 && dl.senseiInsertOwn === null && dl.otherOrgSees === 0 && dl.noUserSees === 0 && dl.noUserInsert !== null && dl.noContextSees === 0,
    JSON.stringify([dl.senseiSees, dl.senseiUpdate, dl.senseiDelete, dl.senseiInsertOwn, dl.otherOrgSees, dl.noUserSees, String(dl.noUserInsert).slice(0, 40), dl.noContextSees]),
  );
  check(
    "Tata letak dashboard: pemilik/organisasi tidak bisa dipindah; isi harus objek dan <= 4000 karakter; hapus pengguna menghapus barisnya",
    dl.moveOwner !== null && dl.moveOrg !== null && /user_dashboard_layouts_layout_check/.test(String(dl.notObject)) && /user_dashboard_layouts_layout_check/.test(String(dl.tooBig)) && dl.cascade === 0,
    JSON.stringify([String(dl.moveOwner).slice(0, 50), String(dl.moveOrg).slice(0, 50), String(dl.notObject).slice(0, 60), String(dl.tooBig).slice(0, 60), dl.cascade]),
  );

  // --- R. Riwayat aktivitas (audit_logs): hanya LPK_ADMIN/TSK_ADMIN membaca; cakupan per organisasi; append-only (UPDATE/DELETE ditolak, termasuk OWNER) ---
  const au: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const uAdmin = allUsers.find((u) => u.role === "LPK_ADMIN" && u.organizationId === lpk1.id)!;
    const uSensei = allUsers.find((u) => u.role === "LPK_SENSEI" && u.organizationId === lpk1.id)!;
    const uAdmin2 = allUsers.find((u) => u.role === "LPK_ADMIN" && u.organizationId === lpk2.id)!;
    const uTskAdmin = allUsers.find((u) => u.role === "TSK_ADMIN")!;
    const uTskStaff = allUsers.find((u) => u.role === "TSK_STAFF")!;
    const cnt = async (orgId: string, role: string | null, userId: string | null) => {
      await actAs(tx, orgId, role, userId);
      return Number((await tx.execute(sql`select count(*)::int as n from audit_logs`)).rows[0].n);
    };
    await actAsSystem(tx);
    const expectOf = async (orgId: string) => Number((await tx.execute(sql`select count(*)::int as n from audit_logs where organization_id = ${orgId}::uuid or actor_org_id = ${orgId}::uuid`)).rows[0].n);
    au.expLpk1 = await expectOf(lpk1.id);
    au.expLpk2 = await expectOf(lpk2.id);
    au.expTsk = await expectOf(tsk.id);
    au.totalAll = Number((await tx.execute(sql`select count(*)::int as n from audit_logs`)).rows[0].n);
    au.lpk1Admin = await cnt(lpk1.id, "LPK_ADMIN", uAdmin.id);
    au.lpk2Admin = await cnt(lpk2.id, "LPK_ADMIN", uAdmin2.id);
    au.tskAdmin = await cnt(tsk.id, "TSK_ADMIN", uTskAdmin.id);
    au.sensei = await cnt(lpk1.id, "LPK_SENSEI", uSensei.id);
    au.tskStaff = await cnt(tsk.id, "TSK_STAFF", uTskStaff.id);
    au.roleNull = await cnt(lpk1.id, null, uAdmin.id);
    au.superAdmin = await cnt(lpk1.id, "SUPER_ADMIN", null);
    au.noContext = Number((await (async () => {
      await tx.execute(sql`select set_config('app.org_id', '', true), set_config('app.role', '', true), set_config('app.user_id', '', true), set_config('app.bypass_rls', 'off', true)`);
      return tx.execute(sql`select count(*)::int as n from audit_logs`);
    })()).rows[0].n);
    // LPK_ADMIN melihat aksi TSK pada kandidatnya (lintas organisasi) tetapi bukan log internal TSK; TSK_ADMIN melihat aksinya, bukan log internal LPK
    await actAs(tx, lpk1.id, "LPK_ADMIN", uAdmin.id);
    au.lpkSeesTskActions = Number((await tx.execute(sql`select count(*)::int as n from audit_logs where actor_org_id = ${tsk.id}::uuid`)).rows[0].n);
    au.lpkSeesTskInternal = Number((await tx.execute(sql`select count(*)::int as n from audit_logs where organization_id = ${tsk.id}::uuid`)).rows[0].n);
    au.lpkSeesOtherLpk = Number((await tx.execute(sql`select count(*)::int as n from audit_logs where organization_id = ${lpk2.id}::uuid and actor_org_id = ${lpk2.id}::uuid`)).rows[0].n);
    await actAs(tx, tsk.id, "TSK_ADMIN", uTskAdmin.id);
    au.tskSeesLpkInternal = Number((await tx.execute(sql`select count(*)::int as n from audit_logs where actor_org_id = ${lpk1.id}::uuid`)).rows[0].n);
    au.tskSeesOwn = Number((await tx.execute(sql`select count(*)::int as n from audit_logs where actor_org_id = ${tsk.id}::uuid`)).rows[0].n);
    // menulis audit tetap boleh untuk peran yang tidak boleh membaca (sensei menulis penilaian)
    await actAs(tx, lpk1.id, "LPK_SENSEI", uSensei.id);
    au.senseiInsert = await attempt(tx, (t) => t.execute(sql`insert into audit_logs (organization_id, actor_org_id, actor_user_id, actor_name, actor_role, actor_org_name, action, entity) values (${lpk1.id}::uuid, ${lpk1.id}::uuid, ${uSensei.id}::uuid, 'x', 'LPK_SENSEI', 'x', 'auth.login', 'user')`));
    // append-only: UPDATE/DELETE ditolak untuk semua jalur
    au.updateApp = await attempt(tx, (t) => t.execute(sql`update audit_logs set action = 'x.y'`));
    au.deleteApp = await attempt(tx, (t) => t.execute(sql`delete from audit_logs`));
    await actAsSystem(tx);
    au.updateSystem = await attempt(tx, (t) => t.execute(sql`update audit_logs set actor_name = 'palsu'`));
    au.deleteSystem = await attempt(tx, (t) => t.execute(sql`delete from audit_logs`));
  });
  const ownerAttempt = async (q: ReturnType<typeof sql>) => {
    try {
      await ownerDb.execute(q);
      return null;
    } catch (err) {
      const e = err as { cause?: { message?: string }; message?: string };
      return e.cause?.message ?? e.message ?? String(err);
    }
  };
  au.updateOwner = await ownerAttempt(sql`update audit_logs set actor_name = 'palsu' where id = (select min(id) from audit_logs)`);
  au.deleteOwner = await ownerAttempt(sql`delete from audit_logs where id = (select min(id) from audit_logs)`);
  check(
    "Riwayat aktivitas: LPK_ADMIN dan TSK_ADMIN membaca tepat log organisasinya (tersimpan di sana atau pelakunya organisasinya); organisasi lain tidak ikut",
    au.lpk1Admin === au.expLpk1 && au.lpk2Admin === au.expLpk2 && au.tskAdmin === au.expTsk && (au.lpk1Admin as number) > 0 && (au.tskAdmin as number) > 0 && (au.lpk1Admin as number) < (au.totalAll as number),
    JSON.stringify([au.lpk1Admin, au.expLpk1, au.lpk2Admin, au.expLpk2, au.tskAdmin, au.expTsk, au.totalAll]),
  );
  check(
    "Riwayat aktivitas: sensei, staf TSK, peran NULL, super admin (jalur aplikasi), dan tanpa konteks membaca 0 baris",
    au.sensei === 0 && au.tskStaff === 0 && au.roleNull === 0 && au.superAdmin === 0 && au.noContext === 0,
    JSON.stringify([au.sensei, au.tskStaff, au.roleNull, au.superAdmin, au.noContext]),
  );
  check(
    "Riwayat aktivitas: LPK_ADMIN melihat aksi TSK pada kandidatnya tetapi bukan log internal TSK maupun LPK lain; TSK_ADMIN melihat aksinya sendiri tetapi bukan log internal LPK",
    (au.lpkSeesTskActions as number) > 0 && au.lpkSeesTskInternal === 0 && au.lpkSeesOtherLpk === 0 && au.tskSeesLpkInternal === 0 && (au.tskSeesOwn as number) > 0,
    JSON.stringify([au.lpkSeesTskActions, au.lpkSeesTskInternal, au.lpkSeesOtherLpk, au.tskSeesLpkInternal, au.tskSeesOwn]),
  );
  check(
    "Riwayat aktivitas: peran yang tidak boleh membaca (sensei) tetap boleh MENULIS audit",
    au.senseiInsert === null,
    String(au.senseiInsert),
  );
  check(
    "Riwayat aktivitas append-only: UPDATE dan DELETE ditolak untuk aplikasi, jalur sistem, dan OWNER",
    [au.updateApp, au.deleteApp, au.updateSystem, au.deleteSystem, au.updateOwner, au.deleteOwner].every((e) => e !== null && /append-only|permission denied/i.test(String(e))),
    JSON.stringify([au.updateApp, au.deleteApp, au.updateSystem, au.deleteSystem, au.updateOwner, au.deleteOwner].map((e) => String(e).slice(0, 50))),
  );

  // --- S. Catatan kegiatan TSK (langkah 7A): hanya staf TSK organisasi pemilik; semua staf membaca semua; tanda baca/laporan hanya atas nama sendiri;
  //        riwayat edit append-only; tidak ada DELETE lewat aplikasi; kunci asing ke kandidat RESTRICT ---
  const ACT_TABLES = ["activity_cases", "activity_case_subjects", "activity_records", "activity_record_subjects", "activity_record_handlers", "activity_record_recipients", "activity_record_reads", "activity_daily_reports", "activity_daily_report_recipients", "periodic_interviews", "periodic_interview_quarter_notes", "case_timeline_events", "activity_attachments", "activity_followups", "activity_revisions"];
  const sr: Record<string, unknown> = {};
  const staff2 = allUsers.find((u) => u.email === "tsk.staff2@hashi.test");
  if (!staff2) throw new Error("Bagian S butuh pengguna tsk.staff2@hashi.test (dibuat db:seed / seed:records)");
  const lpk2AdminUser = allUsers.find((u) => u.role === "LPK_ADMIN" && u.organizationId === lpk2.id)!;
  const countAll = async (tx: Tx, org: string, role: string | null, uid: string | null) => {
    await actAs(tx, org, role, uid);
    let n = 0;
    for (const t of ACT_TABLES) n += Number((await tx.execute(sql.raw(`select count(*)::int as n from ${t}`))).rows[0].n);
    return n;
  };
  const num = async (tx: Tx, q: string) => Number((await tx.execute(sql.raw(q))).rows[0].n);
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const ins = (uid: string, org: string, author = uid, creator = uid) =>
      sql.raw(`insert into activity_records (organization_id, created_by, author_id, kind, record_date, work_type, action_taken) values ('${org}', '${creator}', '${author}', 'daily_work', current_date, 'interview', 'isi awal') returning id::text as id`);

    // ---- isolasi: seed memberi data di TSK A; peran/organisasi lain melihat 0 baris di SEMUA tabel fitur, termasuk lampiran dan riwayat
    sr.adminAll = await countAll(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    sr.staffAll = await countAll(tx, tsk.id, "TSK_STAFF", staffUser.id);
    sr.staff2All = await countAll(tx, tsk.id, "TSK_STAFF", staff2.id);
    sr.others = {
      lpkAdmin: await countAll(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id),
      lpk2Admin: await countAll(tx, lpk2.id, "LPK_ADMIN", lpk2AdminUser.id),
      sensei: await countAll(tx, lpk1.id, "LPK_SENSEI", senseiUser.id),
      tskB: await countAll(tx, tskB, "TSK_ADMIN", adminB),
      superAdmin: await countAll(tx, platformOrg.id, "SUPER_ADMIN", null),
      roleNull: await countAll(tx, tsk.id, null, tskAdminUser.id),
      tskOrgLpkRole: await countAll(tx, tsk.id, "LPK_ADMIN", lpkAdminUser.id),
    };
    await tx.execute(sql`select set_config('app.org_id', '', true), set_config('app.role', '', true), set_config('app.user_id', '', true), set_config('app.bypass_rls', 'off', true)`);
    let none = 0;
    for (const t of ACT_TABLES) none += Number((await tx.execute(sql.raw(`select count(*)::int as n from ${t}`))).rows[0].n);
    (sr.others as Record<string, number>).noContext = none;

    // ---- penulisan: hanya staf TSK organisasi sendiri, atas nama sendiri
    await actAs(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    sr.lpkInsert = await attempt(tx, (t) => t.execute(ins(lpkAdminUser.id, tsk.id)));
    await actAs(tx, tskB, "TSK_ADMIN", adminB);
    sr.tskBInsertIntoA = await attempt(tx, (t) => t.execute(ins(adminB, tsk.id)));
    sr.senseiInsert = await attempt(tx, async (t) => { await actAs(t, lpk1.id, "LPK_SENSEI", senseiUser.id); await t.execute(ins(senseiUser.id, tsk.id)); });
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    sr.staffForOther = await attempt(tx, (t) => t.execute(ins(staffUser.id, tsk.id, tskAdminUser.id)));
    sr.staffCreatorOther = await attempt(tx, (t) => t.execute(ins(staffUser.id, tsk.id, staffUser.id, tskAdminUser.id)));
    const recS = ((await tx.execute(ins(staffUser.id, tsk.id))).rows[0] as { id: string }).id; // catatan staf
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const recA = ((await tx.execute(ins(tskAdminUser.id, tsk.id))).rows[0] as { id: string }).id; // catatan admin
    for (const [label, uid, role] of [["admin", tskAdminUser.id, "TSK_ADMIN"], ["staff2", staff2.id, "TSK_STAFF"]] as const) {
      await actAs(tx, tsk.id, role, uid);
      sr[`reads/${label}`] = await num(tx, `select count(*)::int as n from activity_records where id in ('${recS}', '${recA}')`);
    }

    // ---- hak edit
    await actAs(tx, tsk.id, "TSK_STAFF", staff2.id);
    const upd2 = (await tx.execute(sql`update activity_records set note = ${"diubah staf2"} where kind = 'daily_work' returning author_id::text as a, created_by::text as c`)).rows as Array<{ a: string; c: string }>;
    sr.staff2OnlyOwn = upd2.every((r) => r.a === staff2.id || r.c === staff2.id);
    sr.staff2Touched = upd2.length;
    sr.staff2CannotEditStaff = (await tx.execute(sql.raw(`update activity_records set note = 'x' where id = '${recS}' returning id`))).rows.length;
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const activeDaily = await num(tx, `select count(*)::int as n from activity_records where kind = 'daily_work' and status = 'active'`);
    sr.adminTouched = (await tx.execute(sql`update activity_records set note = ${"diubah admin"} where kind = 'daily_work' and status = 'active' returning id`)).rows.length;
    sr.activeDaily = activeDaily;
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    sr.staffChangesAuthor = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set author_id = '${tskAdminUser.id}' where id = '${recS}'`)));
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    sr.adminChangesAuthor = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set author_id = '${staff2.id}' where id = '${recS}'`)));
    sr.authorNotStaff = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set author_id = '${lpkAdminUser.id}' where id = '${recS}'`)));
    sr.changeKind = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set kind = 'meeting' where id = '${recS}'`)));
    sr.changeOrg = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set organization_id = '${tskB}' where id = '${recS}'`)));
    sr.changeCreatedBy = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set created_by = '${staff2.id}' where id = '${recS}'`)));
    // kolom khusus ① dan ② tidak boleh tercampur; ② wajib perihal dan waktu mulai
    sr.dailyFieldsOnMeeting = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_records (organization_id, created_by, author_id, kind, record_date, subject, started_at, work_type) values ('${tsk.id}', '${tskAdminUser.id}', '${tskAdminUser.id}', 'meeting', current_date, 's', now(), 'interview')`)));
    sr.meetingNoSubject = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_records (organization_id, created_by, author_id, kind, record_date) values ('${tsk.id}', '${tskAdminUser.id}', '${tskAdminUser.id}', 'meeting', current_date)`)));
    sr.meetingFieldsOnDaily = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set subject = 'x' where id = '${recS}'`)));

    // ---- riwayat edit otomatis (nilai SEBELUM), versi naik; aplikasi tidak bisa menulis/mengubah/menghapus riwayat
    await actAs(tx, tsk.id, "TSK_STAFF", staff2.id); // penulis sekarang staf2 (diganti admin di atas)
    await tx.execute(sql.raw(`update activity_records set action_taken = 'versi dua' where id = '${recS}'`));
    await tx.execute(sql.raw(`update activity_records set action_taken = 'versi tiga' where id = '${recS}'`));
    sr.revisions = (await tx.execute(sql.raw(`select version_no, snapshot->>'action_taken' as a, edited_by::text as e from activity_revisions where entity_type = 'record' and entity_id = '${recS}' order by version_no`))).rows;
    sr.versionNo = await num(tx, `select version_no as n from activity_records where id = '${recS}'`);
    sr.revInsert = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_revisions (organization_id, entity_type, entity_id, version_no, snapshot) values ('${tsk.id}', 'record', '${recS}', 99, '{}')`)));
    sr.revUpdate = await attempt(tx, (t) => t.execute(sql`update activity_revisions set version_no = version_no`));
    sr.revDelete = await attempt(tx, (t) => t.execute(sql`delete from activity_revisions`));
    // pembatalan: alasan wajib, final, tetap terbaca
    sr.voidNoReason = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set status = 'void' where id = '${recS}'`)));
    await tx.execute(sql.raw(`update activity_records set status = 'void', void_reason = 'salah input' where id = '${recS}'`));
    sr.editAfterVoid = (await tx.execute(sql.raw(`update activity_records set note = 'lagi' where id = '${recS}' returning id`))).rows.length;
    sr.voidedReadable = await num(tx, `select count(*)::int as n from activity_records where id = '${recS}' and status = 'void' and voided_by is not null and voided_at is not null`);
    // tidak ada DELETE lewat aplikasi untuk tabel utama
    sr.noDelete = await Promise.all(["activity_records", "activity_cases", "case_timeline_events", "activity_followups", "activity_attachments", "periodic_interviews", "activity_daily_reports", "activity_record_reads"].map((t) => attempt(tx, (x) => x.execute(sql.raw(`delete from ${t}`)))));

    // ---- tanda baca dan laporan harian hanya atas nama sendiri
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    sr.readOwn = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_record_reads (record_id, user_id, organization_id, version_no_read) values ('${recA}', '${staffUser.id}', '${tsk.id}', 1)`)));
    sr.readForged = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_record_reads (record_id, user_id, organization_id, version_no_read) values ('${recA}', '${tskAdminUser.id}', '${tsk.id}', 1)`)));
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await tx.execute(sql.raw(`insert into activity_record_reads (record_id, user_id, organization_id, version_no_read) values ('${recA}', '${tskAdminUser.id}', '${tsk.id}', 1)`));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    sr.readUpdateOthers = (await tx.execute(sql`update activity_record_reads set version_no_read = 99 returning user_id`)).rows.every((r) => r.user_id === staffUser.id);
    sr.readMine = await num(tx, `select count(*)::int as n from activity_record_reads where record_id = '${recA}' and user_id = '${tskAdminUser.id}' and version_no_read = 1`);
    // laporan harian: bukan penulis tidak bisa membuat/mengirim atas nama orang lain
    sr.reportForged = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_daily_reports (organization_id, created_by, author_id, report_date) values ('${tsk.id}', '${staffUser.id}', '${tskAdminUser.id}', current_date + 30)`)));
    const rpt = ((await tx.execute(sql.raw(`insert into activity_daily_reports (organization_id, created_by, author_id, report_date) values ('${tsk.id}', '${staffUser.id}', '${staffUser.id}', current_date + 31) returning id::text as id`))).rows[0] as { id: string }).id;
    await tx.execute(sql.raw(`update activity_daily_reports set shared_at = now() where id = '${rpt}'`));
    sr.sharedBy = await num(tx, `select count(*)::int as n from activity_daily_reports where id = '${rpt}' and shared_by = '${staffUser.id}' and shared_at is not null`);
    await actAs(tx, tsk.id, "TSK_STAFF", staff2.id);
    const hijack = (await tx.execute(sql`update activity_daily_reports set shared_at = now() returning author_id::text as a`)).rows as Array<{ a: string }>;
    sr.reportHijack = hijack.every((r) => r.a === staff2.id); // tanpa WHERE: hanya laporan milik sendiri
    sr.reportRecipientsForged = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_daily_report_recipients (report_id, user_id, organization_id) values ('${rpt}', '${staff2.id}', '${tsk.id}')`)));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    await tx.execute(sql.raw(`insert into activity_daily_report_recipients (report_id, user_id, organization_id) values ('${rpt}', '${tskAdminUser.id}', '${tsk.id}'), ('${rpt}', '${staff2.id}', '${tsk.id}')`));
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const mark = (await tx.execute(sql`update activity_daily_report_recipients set read_at = now() returning user_id::text as u`)).rows as Array<{ u: string }>;
    sr.recipientMarkOnlyOwn = mark.length > 0 && mark.every((r) => r.u === tskAdminUser.id);
    sr.recipientRead = await num(tx, `select count(*)::int as n from activity_daily_report_recipients where report_id = '${rpt}' and user_id = '${staff2.id}' and read_at is not null`);
    sr.recipientColumns = await attempt(tx, (t) => t.execute(sql`update activity_daily_report_recipients set user_id = user_id`)); // no-op boleh; mengganti user ditolak di bawah
    sr.recipientChangeUser = await attempt(tx, (t) => t.execute(sql.raw(`update activity_daily_report_recipients set user_id = '${staffUser.id}' where report_id = '${rpt}' and user_id = '${tskAdminUser.id}'`)));

    // ---- tugas tindak lanjut: status hanya penanggung jawab, pembuat, atau TSK_ADMIN; hanya status yang bisa diubah
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    const fid = ((await tx.execute(sql.raw(`insert into activity_followups (organization_id, created_by, record_id, description, assignee_id) values ('${tsk.id}', '${staffUser.id}', '${recA}', 'uji', '${staff2.id}') returning id::text as id`))).rows[0] as { id: string }).id;
    sr.fuAssigneeNotStaff = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_followups (organization_id, created_by, record_id, description, assignee_id) values ('${tsk.id}', '${staffUser.id}', '${recA}', 'uji', '${lpkAdminUser.id}')`)));
    sr.fuNoParent = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_followups (organization_id, created_by, description, assignee_id) values ('${tsk.id}', '${staffUser.id}', 'uji', '${staffUser.id}')`)));
    await actAs(tx, tsk.id, "TSK_STAFF", staff2.id);
    sr.fuEditText = await attempt(tx, (t) => t.execute(sql.raw(`update activity_followups set description = 'ubah' where id = '${fid}'`)));
    // staf ketiga tidak berhak: buat staf lain
    const staffC = await makeUser(tx, tsk.id, "TSK_STAFF");
    await actAs(tx, tsk.id, "TSK_STAFF", staffC);
    sr.fuOtherStaff = (await tx.execute(sql.raw(`update activity_followups set status = 'done' where id = '${fid}' returning id`))).rows.length;
    await actAs(tx, tsk.id, "TSK_STAFF", staff2.id);
    sr.fuAssignee = (await tx.execute(sql.raw(`update activity_followups set status = 'done' where id = '${fid}' returning id`))).rows.length;
    sr.fuDoneStamped = await num(tx, `select count(*)::int as n from activity_followups where id = '${fid}' and done_by = '${staff2.id}' and done_at is not null`);
    sr.fuReopen = await attempt(tx, (t) => t.execute(sql.raw(`update activity_followups set status = 'open' where id = '${fid}'`)));

    // ---- kasus: kode berurutan per organisasi per tahun; TSK lain mulai dari 0001 sendiri
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const c1 = ((await tx.execute(sql.raw(`insert into activity_cases (organization_id, created_by, code, title, category) values ('${tsk.id}', '${tskAdminUser.id}', '', 'a', 'trouble') returning code`))).rows[0] as { code: string }).code;
    const c2 = ((await tx.execute(sql.raw(`insert into activity_cases (organization_id, created_by, code, title, category) values ('${tsk.id}', '${tskAdminUser.id}', '', 'b', 'other') returning code`))).rows[0] as { code: string }).code;
    await actAs(tx, tskB, "TSK_ADMIN", adminB);
    const b1 = ((await tx.execute(sql.raw(`insert into activity_cases (organization_id, created_by, code, title, category) values ('${tskB}', '${adminB}', '', 'b1', 'other') returning code`))).rows[0] as { code: string }).code;
    sr.caseCodes = [c1, c2, b1];
    sr.caseBadCategory = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_cases (organization_id, created_by, code, title, category) values ('${tskB}', '${adminB}', '', 'x', 'bukan-kategori')`)));
    sr.caseCodeImmutable = await attempt(tx, (t) => t.execute(sql.raw(`update activity_cases set code = 'K-1999-0001' where title = 'b1'`)));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    sr.staffEditsAdminCase = (await tx.execute(sql.raw(`update activity_cases set title = 'diubah' where title = 'a' returning id`))).rows.length;

    // ---- lampiran: hanya keterangan, sertakan-di-PDF, dan penandaan sembunyi yang bisa diubah; tipe dan ukuran dibatasi
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const aid = ((await tx.execute(sql.raw(`insert into activity_attachments (organization_id, created_by, record_id, mime, size_bytes, original_name) values ('${tsk.id}', '${tskAdminUser.id}', '${recA}', 'image/png', 100, 'a.png') returning id::text as id`))).rows[0] as { id: string }).id;
    sr.attBadMime = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_attachments (organization_id, created_by, record_id, mime, size_bytes, original_name) values ('${tsk.id}', '${tskAdminUser.id}', '${recA}', 'application/pdf', 100, 'a.pdf')`)));
    sr.attTooBig = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_attachments (organization_id, created_by, record_id, mime, size_bytes, original_name) values ('${tsk.id}', '${tskAdminUser.id}', '${recA}', 'image/png', 10485761, 'a.png')`)));
    sr.attNoParent = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_attachments (organization_id, created_by, mime, size_bytes, original_name) values ('${tsk.id}', '${tskAdminUser.id}', 'image/png', 100, 'a.png')`)));
    sr.attChangeMime = await attempt(tx, (t) => t.execute(sql.raw(`update activity_attachments set mime = 'image/jpeg' where id = '${aid}'`)));
    sr.attCaption = await attempt(tx, (t) => t.execute(sql.raw(`update activity_attachments set caption = 'ok', include_in_pdf = true where id = '${aid}'`)));
    await tx.execute(sql.raw(`update activity_attachments set removed_at = now() where id = '${aid}'`));
    sr.attRemovedBy = await num(tx, `select count(*)::int as n from activity_attachments where id = '${aid}' and removed_by = '${tskAdminUser.id}'`);
    sr.attRestore = await attempt(tx, (t) => t.execute(sql.raw(`update activity_attachments set removed_at = null where id = '${aid}'`)));

    // ---- subjek harus kandidat yang terlihat TSK (LPK non-mitra tidak terlihat); wawancara berkala: unik per bulan aktif, tanggal 1
    const [hidden] = (await tx.execute(sql`select c.id::text as id from candidates c where c.organization_id = ${lpk3.id}::uuid limit 1`)).rows as Array<{ id: string }>;
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    sr.subjectInvisible = hidden ? await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_record_subjects (record_id, candidate_id, organization_id) values ('${recA}', '${hidden.id}', '${tsk.id}')`))) : "(tidak ada kandidat uji)";
    sr.interviewInvisible = hidden ? await attempt(tx, (t) => t.execute(sql.raw(`insert into periodic_interviews (organization_id, created_by, candidate_id, period_month, result_status) values ('${tsk.id}', '${tskAdminUser.id}', '${hidden.id}', '2020-01-01', 'no_issue')`))) : "(tidak ada kandidat uji)";
    const [vis] = (await tx.execute(sql`select p.candidate_id::text as id from placements p where p.status = 'ACTIVE' limit 1`)).rows as Array<{ id: string }>;
    sr.piBadMonth = await attempt(tx, (t) => t.execute(sql.raw(`insert into periodic_interviews (organization_id, created_by, candidate_id, period_month, result_status) values ('${tsk.id}', '${tskAdminUser.id}', '${vis.id}', '2020-01-15', 'no_issue')`)));
    sr.piBadStatus = await attempt(tx, (t) => t.execute(sql.raw(`insert into periodic_interviews (organization_id, created_by, candidate_id, period_month, result_status) values ('${tsk.id}', '${tskAdminUser.id}', '${vis.id}', '2020-01-01', 'bagus')`)));
    await tx.execute(sql.raw(`insert into periodic_interviews (organization_id, created_by, candidate_id, period_month, result_status, reason) values ('${tsk.id}', '${tskAdminUser.id}', '${vis.id}', '2020-01-01', 'no_issue', 'agency')`));
    sr.piDuplicate = await attempt(tx, (t) => t.execute(sql.raw(`insert into periodic_interviews (organization_id, created_by, candidate_id, period_month, result_status) values ('${tsk.id}', '${tskAdminUser.id}', '${vis.id}', '2020-01-01', 'issue')`)));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id); // semua staf boleh mengubah wawancara berkala; riwayat otomatis
    await tx.execute(sql.raw(`update periodic_interviews set result_status = 'follow_up', content = 'ubah' where candidate_id = '${vis.id}' and period_month = '2020-01-01'`));
    sr.piRevision = await num(tx, `select count(*)::int as n from activity_revisions where entity_type = 'periodic_interview' and snapshot->>'result_status' = 'no_issue' and edited_by = '${staffUser.id}'`);
    sr.piVoidNoReason = await attempt(tx, (t) => t.execute(sql.raw(`update periodic_interviews set status = 'void' where candidate_id = '${vis.id}' and period_month = '2020-01-01'`)));
    await tx.execute(sql.raw(`update periodic_interviews set status = 'void', void_reason = 'salah bulan' where candidate_id = '${vis.id}' and period_month = '2020-01-01'`));
    await tx.execute(sql.raw(`insert into periodic_interviews (organization_id, created_by, candidate_id, period_month, result_status, reason) values ('${tsk.id}', '${staffUser.id}', '${vis.id}', '2020-01-01', 'no_issue', 'agency')`)); // yang dibatalkan tidak menghalangi isian ulang
    sr.piRefilled = true;

    // ---- kronologi: hanya pembuat/TSK_ADMIN mengubah; dibatalkan final
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    const cid = ((await tx.execute(sql.raw(`insert into activity_cases (organization_id, created_by, code, title, category) values ('${tsk.id}', '${staffUser.id}', '', 'kasus staf', 'other') returning id::text as id`))).rows[0] as { id: string }).id;
    const eid = ((await tx.execute(sql.raw(`insert into case_timeline_events (organization_id, created_by, case_id, occurred_at, event) values ('${tsk.id}', '${staffUser.id}', '${cid}', now(), 'kejadian') returning id::text as id`))).rows[0] as { id: string }).id;
    await actAs(tx, tsk.id, "TSK_STAFF", staff2.id);
    sr.eventOtherStaffEdit = (await tx.execute(sql.raw(`update case_timeline_events set event = 'ubah' where id = '${eid}' returning id`))).rows.length;
    sr.eventAddByOther = await attempt(tx, (t) => t.execute(sql.raw(`insert into case_timeline_events (organization_id, created_by, case_id, occurred_at, event) values ('${tsk.id}', '${staff2.id}', '${cid}', now(), 'tambah oleh staf lain')`)));
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    sr.eventAdminEdit = (await tx.execute(sql.raw(`update case_timeline_events set event = 'diubah admin' where id = '${eid}' returning id`))).rows.length;
    sr.eventRevisions = await num(tx, `select count(*)::int as n from activity_revisions where entity_type = 'timeline_event' and entity_id = '${eid}'`);
    sr.eventVoidNoReason = await attempt(tx, (t) => t.execute(sql.raw(`update case_timeline_events set status = 'void' where id = '${eid}'`)));
    await tx.execute(sql.raw(`update case_timeline_events set status = 'void', void_reason = 'duplikat' where id = '${eid}'`));
    sr.eventEditAfterVoid = (await tx.execute(sql.raw(`update case_timeline_events set event = 'lagi' where id = '${eid}' returning id`))).rows.length;
    // tutup/buka kasus: dicatat waktu dan pelaku, riwayat otomatis
    await tx.execute(sql.raw(`update activity_cases set status = 'closed' where id = '${cid}'`));
    sr.caseClosed = await num(tx, `select count(*)::int as n from activity_cases where id = '${cid}' and closed_by = '${tskAdminUser.id}' and closed_at is not null`);
    await tx.execute(sql.raw(`update activity_cases set status = 'open' where id = '${cid}'`));
    sr.caseReopened = await num(tx, `select count(*)::int as n from activity_cases where id = '${cid}' and closed_by is null and closed_at is null`);
    sr.caseRevisions = await num(tx, `select count(*)::int as n from activity_revisions where entity_type = 'case' and entity_id = '${cid}'`);

    // ---- hapus kandidat oleh LPK_ADMIN pemilik: ditolak bila ada catatan kegiatan, dan ringkasan melaporkan blocked
    await actAsSystem(tx);
    const [lp] = (await tx.execute(sql`insert into candidates (organization_id, full_name, gender, birth_date, stage, shared_with_tsk) values (${lpk1.id}::uuid, 'Uji Catatan', 'MALE', '2000-01-01', 'READY', true) returning id::text as id`)).rows as Array<{ id: string }>;
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await tx.execute(sql.raw(`insert into periodic_interview_quarter_notes (organization_id, created_by, candidate_id, fiscal_year, quarter, note) values ('${tsk.id}', '${tskAdminUser.id}', '${lp.id}', 2026, 1, 'catatan')`));
    await actAs(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    sr.lpkDelete = await attempt(tx, (t) => t.execute(sql.raw(`delete from candidates where id = '${lp.id}'`)));
    sr.lpkSummaryBlocked = ((await tx.execute(sql.raw(`select candidate_delete_summary('${lp.id}'::uuid) as s`))).rows[0] as { s: { blocked: boolean } }).s.blocked;
    sr.workerDelete = await attempt(tx, (t) => t.execute(sql.raw(`delete from candidates where id = '${vis.id}'`)));
  });
  // Di luar sandbox, lewat OWNER: riwayat di seed tidak bisa diubah/dihapus siapa pun, dan kunci asing ke kandidat RESTRICT
  sr.ownerRevUpdate = await ownerAttempt(sql`update activity_revisions set version_no = version_no where id = (select min(id) from activity_revisions)`);
  sr.ownerRevDelete = await ownerAttempt(sql`delete from activity_revisions where id = (select min(id) from activity_revisions)`);
  sr.fkRestrict = ((await ownerDb.execute(sql`select c.conrelid::regclass::text as t, c.confdeltype as d from pg_constraint c where c.contype = 'f' and c.confrelid = 'candidates'::regclass and c.conrelid::regclass::text in ('activity_case_subjects', 'activity_record_subjects', 'periodic_interviews', 'periodic_interview_quarter_notes', 'residence_cards') order by 1`)).rows as Array<{ t: string; d: string }>).map((r) => `${r.t}:${r.d}`);
  sr.seedRows = {
    records: Number(((await ownerDb.execute(sql`select count(*)::int as n from activity_records`)).rows[0] as { n: number }).n),
    revisions: Number(((await ownerDb.execute(sql`select count(*)::int as n from activity_revisions`)).rows[0] as { n: number }).n),
  };
  const others = sr.others as Record<string, number>;
  const E = (v: unknown) => typeof v === "string" && v.length > 0; // error ada
  check(
    "Catatan kegiatan: semua staf TSK (admin dan staf) membaca semua catatan; LPK_ADMIN, sensei, LPK lain, TSK lain, super admin, peran null, peran LPK di organisasi TSK, dan tanpa konteks melihat 0 baris di SEMUA tabel fitur (termasuk lampiran dan riwayat)",
    (sr.adminAll as number) > 20 && sr.adminAll === sr.staffAll && sr.adminAll === sr.staff2All && Object.values(others).every((n) => n === 0) && sr["reads/admin"] === 2 && sr["reads/staff2"] === 2,
    JSON.stringify([sr.adminAll, sr.staffAll, sr.staff2All, others]),
  );
  check(
    "Catatan kegiatan: menulis hanya staf TSK organisasi sendiri atas nama sendiri (LPK, TSK lain, sensei, dan menulis atas nama/pembuat orang lain ditolak)",
    E(sr.lpkInsert) && E(sr.tskBInsertIntoA) && E(sr.senseiInsert) && E(sr.staffForOther) && E(sr.staffCreatorOther),
    JSON.stringify([sr.lpkInsert, sr.tskBInsertIntoA, sr.senseiInsert, sr.staffForOther, sr.staffCreatorOther].map((e) => String(e).slice(0, 50))),
  );
  check(
    "Catatan kegiatan: UPDATE tanpa WHERE: staf hanya mengenai catatan miliknya, TSK_ADMIN semua yang aktif; ganti penulis hanya TSK_ADMIN dan harus staf TSK; kind/organisasi/pembuat tidak bisa diganti",
    sr.staff2OnlyOwn === true && sr.staff2CannotEditStaff === 0 && sr.adminTouched === sr.activeDaily && E(sr.staffChangesAuthor) && sr.adminChangesAuthor === null && E(sr.authorNotStaff) && E(sr.changeKind) && E(sr.changeOrg) && E(sr.changeCreatedBy),
    JSON.stringify([sr.staff2OnlyOwn, sr.staff2Touched, sr.staff2CannotEditStaff, sr.adminTouched, sr.activeDaily, String(sr.staffChangesAuthor).slice(0, 40), sr.adminChangesAuthor]),
  );
  check(
    "Catatan kegiatan: kolom khusus ① tidak boleh di ② dan sebaliknya; ② wajib perihal dan waktu mulai (CHECK)",
    E(sr.dailyFieldsOnMeeting) && E(sr.meetingNoSubject) && E(sr.meetingFieldsOnDaily),
    JSON.stringify([sr.dailyFieldsOnMeeting, sr.meetingNoSubject, sr.meetingFieldsOnDaily].map((e) => String(e).slice(0, 60))),
  );
  const revs = sr.revisions as Array<{ version_no: number; a: string; e: string | null }>;
  check(
    "Riwayat edit otomatis (trigger): tiap edit menaikkan versi dan menyimpan nilai SEBELUM beserta pengedit; aplikasi tidak bisa menulis, mengubah, atau menghapus riwayat; TSK lain tidak melihatnya",
    revs.length >= 2 && sr.versionNo === revs.length + 1 && revs.every((r, i) => r.version_no === i + 1 && r.e !== null) && revs.at(-2)!.a === "isi awal" && revs.at(-1)!.a === "versi dua" && revs.at(-2)!.e === staff2.id && revs.at(-1)!.e === staff2.id && revs[0].e === tskAdminUser.id && E(sr.revInsert) && E(sr.revUpdate) && E(sr.revDelete),
    JSON.stringify([sr.versionNo, revs, String(sr.revInsert).slice(0, 40), String(sr.revUpdate).slice(0, 40), String(sr.revDelete).slice(0, 40)]),
  );
  check(
    "Riwayat edit append-only juga untuk OWNER (trigger), dan baris riwayat dari seed ada",
    /append-only/.test(String(sr.ownerRevUpdate)) && /append-only/.test(String(sr.ownerRevDelete)) && (sr.seedRows as { revisions: number }).revisions > 0,
    JSON.stringify([String(sr.ownerRevUpdate).slice(0, 50), String(sr.ownerRevDelete).slice(0, 50), sr.seedRows]),
  );
  check(
    "Catatan kegiatan: pembatalan butuh alasan, final (tidak bisa diubah lagi), tetap terbaca dengan pelaku dan waktu; TIDAK ada DELETE lewat aplikasi di tabel utama",
    E(sr.voidNoReason) && sr.editAfterVoid === 0 && sr.voidedReadable === 1 && (sr.noDelete as unknown[]).every(E),
    JSON.stringify([String(sr.voidNoReason).slice(0, 40), sr.editAfterVoid, sr.voidedReadable, (sr.noDelete as unknown[]).map((e) => String(e).slice(0, 25))]),
  );
  check(
    "Tanda baca: hanya atas nama sendiri (atas nama orang lain ditolak, UPDATE tanpa WHERE hanya milik sendiri)",
    sr.readOwn === null && E(sr.readForged) && sr.readUpdateOthers === true && sr.readMine === 1,
    JSON.stringify([sr.readOwn, String(sr.readForged).slice(0, 40), sr.readUpdateOthers, sr.readMine]),
  );
  check(
    "Laporan harian: membuat dan mengirim hanya atas nama sendiri; UPDATE tanpa WHERE hanya laporan sendiri; penerima hanya menandai baca miliknya dan tidak bisa mengganti penerima",
    E(sr.reportForged) && sr.sharedBy === 1 && sr.reportHijack === true && E(sr.reportRecipientsForged) && sr.recipientMarkOnlyOwn === true && sr.recipientRead === 0 && E(sr.recipientChangeUser),
    JSON.stringify([String(sr.reportForged).slice(0, 40), sr.sharedBy, sr.reportHijack, String(sr.reportRecipientsForged).slice(0, 40), sr.recipientMarkOnlyOwn, sr.recipientRead, String(sr.recipientChangeUser).slice(0, 40)]),
  );
  check(
    "Tugas tindak lanjut: status diubah penanggung jawab/pembuat/TSK_ADMIN (staf lain 0 baris); hanya status yang bisa diubah; selesai final dan tercatat pelakunya; penanggung jawab harus staf TSK; wajib punya induk",
    E(sr.fuAssigneeNotStaff) && E(sr.fuNoParent) && E(sr.fuEditText) && sr.fuOtherStaff === 0 && sr.fuAssignee === 1 && sr.fuDoneStamped === 1 && E(sr.fuReopen),
    JSON.stringify([String(sr.fuAssigneeNotStaff).slice(0, 30), String(sr.fuNoParent).slice(0, 30), String(sr.fuEditText).slice(0, 30), sr.fuOtherStaff, sr.fuAssignee, sr.fuDoneStamped, String(sr.fuReopen).slice(0, 30)]),
  );
  const codes = sr.caseCodes as string[];
  const yr = codes[0].slice(2, 6);
  check(
    "Kode kasus berurutan per organisasi per tahun (TSK lain mulai dari nomor 1 sendiri); kode tidak bisa diganti; kategori dibatasi; staf bukan pembuat tidak bisa mengubah kasus",
    /^K-\d{4}-\d{4}$/.test(codes[0]) && Number(codes[1].slice(-4)) === Number(codes[0].slice(-4)) + 1 && codes[1].slice(2, 6) === yr && codes[2] === `K-${yr}-0001` && E(sr.caseBadCategory) && E(sr.caseCodeImmutable) && sr.staffEditsAdminCase === 0,
    JSON.stringify([codes, String(sr.caseBadCategory).slice(0, 40), String(sr.caseCodeImmutable).slice(0, 40), sr.staffEditsAdminCase]),
  );
  check(
    "Lampiran: tipe dibatasi gambar, ukuran <= 10 MB, wajib satu induk; hanya keterangan/sertakan-PDF/penandaan sembunyi yang bisa diubah; yang disembunyikan tidak bisa dipulihkan lewat aplikasi",
    E(sr.attBadMime) && E(sr.attTooBig) && E(sr.attNoParent) && E(sr.attChangeMime) && sr.attCaption === null && sr.attRemovedBy === 1 && E(sr.attRestore),
    JSON.stringify([String(sr.attBadMime).slice(0, 30), String(sr.attTooBig).slice(0, 30), String(sr.attNoParent).slice(0, 30), String(sr.attChangeMime).slice(0, 30), sr.attCaption, sr.attRemovedBy, String(sr.attRestore).slice(0, 30)]),
  );
  check(
    "Subjek dan wawancara berkala: hanya kandidat yang terlihat TSK; tanggal bulan harus tanggal 1; status dibatasi; unik per bulan aktif (yang dibatalkan boleh diisi ulang); edit semua staf dengan riwayat otomatis; pembatalan butuh alasan",
    E(sr.subjectInvisible) && E(sr.interviewInvisible) && E(sr.piBadMonth) && E(sr.piBadStatus) && E(sr.piDuplicate) && sr.piRevision === 1 && E(sr.piVoidNoReason) && sr.piRefilled === true,
    JSON.stringify([String(sr.subjectInvisible).slice(0, 30), String(sr.interviewInvisible).slice(0, 30), String(sr.piBadMonth).slice(0, 30), String(sr.piBadStatus).slice(0, 30), String(sr.piDuplicate).slice(0, 30), sr.piRevision]),
  );
  check(
    "Kronologi dan kasus: hanya pembuat/TSK_ADMIN mengubah baris (staf lain 0 baris, tetapi boleh menambah baris); riwayat otomatis; batal butuh alasan dan final; tutup/buka kasus tercatat pelaku dan waktu",
    sr.eventOtherStaffEdit === 0 && sr.eventAddByOther === null && sr.eventAdminEdit === 1 && sr.eventRevisions === 1 && E(sr.eventVoidNoReason) && sr.eventEditAfterVoid === 0 && sr.caseClosed === 1 && sr.caseReopened === 1 && (sr.caseRevisions as number) === 2,
    JSON.stringify([sr.eventOtherStaffEdit, sr.eventAddByOther, sr.eventAdminEdit, sr.eventRevisions, String(sr.eventVoidNoReason).slice(0, 30), sr.eventEditAfterVoid, sr.caseClosed, sr.caseReopened, sr.caseRevisions]),
  );
  check(
    "Hapus kandidat: kunci asing ke kandidat RESTRICT di 5 tabel fitur; LPK_ADMIN pemilik ditolak menghapus kandidat yang punya catatan kegiatan (ringkasan blocked=true), juga pekerja yang punya catatan",
    J(sr.fkRestrict) === J(["activity_case_subjects:r", "activity_record_subjects:r", "periodic_interview_quarter_notes:r", "periodic_interviews:r", "residence_cards:r"]) && /tidak bisa dihapus/.test(String(sr.lpkDelete)) && sr.lpkSummaryBlocked === true && /tidak bisa dihapus/.test(String(sr.workerDelete)),
    JSON.stringify([sr.fkRestrict, String(sr.lpkDelete).slice(0, 60), sr.lpkSummaryBlocked, String(sr.workerDelete).slice(0, 60)]),
  );

  // --- T. Lembar klien (langkah 6): kolom baru klien/lokasi/job order tetap TSK-only (LPK, sensei, super admin, TSK lain, peran null: tidak terbaca dan tidak bisa diubah); CHECK nilai ---
  const tr: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const [co] = await tx.insert(clientCompanies).values({ orgId: tsk.id, name: "Perusahaan T", industry: "RAHASIA-INDUSTRI", employeeCount: 10, foreignWorkerExperience: "RAHASIA-EXP", publicIntro: "RAHASIA-INTRO" }).returning();
    const [si] = await tx.insert(clientSites).values({ orgId: tsk.id, companyId: co.id, name: "Lokasi T", accessNote: "RAHASIA-AKSES" }).returning();
    const [food] = await tx.select({ id: skillFields.id }).from(skillFields).where(eq(skillFields.code, "food"));
    await tx.insert(clientSiteFields).values({ siteId: si.id, fieldId: food.id, orgId: tsk.id });
    const [jo] = await tx.insert(jobOrders).values({ orgId: tsk.id, siteId: si.id, fieldId: food.id, title: "JO T", housing: "provided", workHours: "RAHASIA-JAM", daysOff: "RAHASIA-LIBUR", commuteNote: "RAHASIA-JALAN", benefitsNote: "RAHASIA-FASILITAS" }).returning();
    const seen = async () => {
      const q = async (query: string) => Number((await tx.execute(sql.raw(query))).rows[0].n);
      return [
        await q("select count(*)::int as n from client_companies where public_intro = 'RAHASIA-INTRO' or industry = 'RAHASIA-INDUSTRI'"),
        await q("select count(*)::int as n from client_sites where access_note = 'RAHASIA-AKSES'"),
        await q("select count(*)::int as n from job_orders where work_hours = 'RAHASIA-JAM' or housing = 'provided' and title = 'JO T'"),
      ];
    };
    const MARK = "DITANDAI-T";
    const actors: Array<[string, string, string | null, string | null]> = [
      ["tskAdminA", tsk.id, "TSK_ADMIN", tskAdminUser.id],
      ["tskStaffA", tsk.id, "TSK_STAFF", staffUser.id],
      ["tskAdminB", tskB, "TSK_ADMIN", adminB],
      ["lpkAdmin", lpk1.id, "LPK_ADMIN", lpkAdminUser.id],
      ["sensei", lpk1.id, "LPK_SENSEI", lpkAdminUser.id],
      ["superAdmin", platformOrg.id, "SUPER_ADMIN", null],
      ["roleNull", tsk.id, null, null],
    ];
    for (const [who, org, role, uid] of actors) {
      await actAs(tx, org, role, uid);
      tr[`read/${who}`] = await seen();
      // UPDATE tanpa WHERE atas kolom baru: baris apa yang berubah (dihitung sebagai sistem)
      await scratch(tx, async (sp) => {
        await actAs(sp, org, role, uid);
        await attempt(sp, (t) => t.update(clientCompanies).set({ publicIntro: MARK }));
        await attempt(sp, (t) => t.update(clientSites).set({ accessNote: MARK }));
        await attempt(sp, (t) => t.update(jobOrders).set({ workHours: MARK }));
        await actAsSystem(sp);
        tr[`updated/${who}`] = [
          (await sp.select({ o: clientCompanies.orgId }).from(clientCompanies).where(eq(clientCompanies.publicIntro, MARK))).map((r) => r.o === tsk.id ? "A" : "lain").join(","),
          (await sp.select({ o: clientSites.orgId }).from(clientSites).where(eq(clientSites.accessNote, MARK))).map((r) => r.o === tsk.id ? "A" : "lain").join(","),
          (await sp.select({ o: jobOrders.orgId }).from(jobOrders).where(eq(jobOrders.workHours, MARK))).map((r) => r.o === tsk.id ? "A" : "lain").join(","),
        ];
      });
    }
    await actAsSystem(tx);
    tr.negEmployees = await attempt(tx, (t) => t.update(clientCompanies).set({ employeeCount: -1 }).where(eq(clientCompanies.id, co.id)));
    tr.badHousing = await attempt(tx, (t) => t.update(jobOrders).set({ housing: "bogus" }).where(eq(jobOrders.id, jo.id)));
    tr.nullsOk = await attempt(tx, (t) => t.update(jobOrders).set({ housing: null, workHours: null }).where(eq(jobOrders.id, jo.id)));
  });
  const z = (v: unknown) => JSON.stringify(v) === JSON.stringify([0, 0, 0]);
  const owned = (who: string) => JSON.stringify(tr[`read/${who}`]) === JSON.stringify([1, 1, 1]);
  check(
    "Lembar klien: kolom baru (jenis usaha, perkenalan, akses, jam kerja, tempat tinggal, ...) hanya terbaca staf TSK pemilik; LPK_ADMIN, sensei, super admin, TSK lain, dan peran null membaca 0 baris",
    owned("tskAdminA") && owned("tskStaffA") && ["tskAdminB", "lpkAdmin", "sensei", "superAdmin", "roleNull"].every((w) => z(tr[`read/${w}`])),
    JSON.stringify(Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith("read/")))),
  );
  check(
    "Lembar klien: UPDATE tanpa WHERE atas kolom baru hanya mengubah baris TSK pemilik (staf TSK A); selain itu 0 baris",
    ["tskAdminA", "tskStaffA"].every((w) => (tr[`updated/${w}`] as string[]).every((x) => x === "A" || x.split(",").every((y) => y === "A"))) &&
      ["tskAdminB", "lpkAdmin", "sensei", "superAdmin", "roleNull"].every((w) => (tr[`updated/${w}`] as string[]).every((x) => x === "")),
    JSON.stringify(Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith("updated/")))),
  );
  check(
    "Lembar klien: jumlah karyawan tidak boleh negatif; tempat tinggal hanya provided/allowance/none/unspecified; semua kolom boleh dikosongkan",
    /client_companies_employee_count_check/.test(String(tr.negEmployees)) && /job_orders_housing_check/.test(String(tr.badHousing)) && tr.nullsOk === null,
    `${String(tr.negEmployees).slice(0, 60)} | ${String(tr.badHousing).slice(0, 60)}`,
  );

  // --- U. Lanjutkan catatan (T-007): continues_record_id. Hanya staf TSK organisasi sama; asal harus ada/terlihat, aktif, dan satu pekerja sama (diperiksa saat COMMIT);
  //        terkunci setelah dibuat; tidak terbaca LPK/sensei/TSK lain ---
  const ur: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const workers = (await tx.execute(sql`select distinct p.candidate_id::text as id from placements p where p.status = 'ACTIVE' limit 2`)).rows as Array<{ id: string }>;
    if (workers.length < 2) throw new Error("Bagian U butuh >= 2 pekerja aktif (seed)");
    const [w1, w2] = [workers[0].id, workers[1].id];
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const rec = async (cont: string | null, worker: string, uid = tskAdminUser.id) => {
      const id = ((await tx.execute(sql.raw(`insert into activity_records (organization_id, created_by, author_id, kind, record_date, work_type, action_taken, continues_record_id) values ('${tsk.id}', '${uid}', '${uid}', 'daily_work', current_date, 'interview', 'lanjutan uji', ${cont ? `'${cont}'` : "null"}) returning id::text as id`))).rows[0] as { id: string }).id;
      await tx.execute(sql.raw(`insert into activity_record_subjects (record_id, candidate_id, organization_id) values ('${id}', '${worker}', '${tsk.id}')`));
      return id;
    };
    const parent = await rec(null, w1);
    // valid: pekerja sama, asal aktif, organisasi sama (pemeriksaan tertunda dipaksa berjalan sekarang)
    ur.valid = await attempt(tx, async (t) => { await rec(parent, w1); await t.execute(sql`set constraints activity_records_continue_subjects immediate`); });
    ur.validCount = await num(tx, `select count(*)::int as n from activity_records where continues_record_id = '${parent}'`);
    // pekerja tidak sama -> ditolak saat commit
    ur.otherWorker = await attempt(tx, async (t) => { await rec(parent, w2); await t.execute(sql`set constraints activity_records_continue_subjects immediate`); });
    // asal sudah dibatalkan -> ditolak
    const voided = await rec(null, w1);
    await tx.execute(sql.raw(`update activity_records set status = 'void', void_reason = 'uji' where id = '${voided}'`));
    ur.voidParent = await attempt(tx, async () => { await rec(voided, w1); });
    // asal tidak ada
    ur.missingParent = await attempt(tx, async () => { await rec("00000000-0000-4000-8000-000000000000", w1); });
    // menunjuk diri sendiri
    ur.selfRef = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set continues_record_id = id where id = '${parent}'`)));
    // terkunci setelah dibuat (juga bagi pembuatnya sendiri)
    const child = ((await tx.execute(sql.raw(`select id::text as id from activity_records where continues_record_id = '${parent}' limit 1`))).rows[0] as { id: string }).id;
    ur.lockedChange = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set continues_record_id = '${voided}' where id = '${child}'`)));
    ur.lockedClear = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set continues_record_id = null where id = '${child}'`)));
    ur.editOtherFieldOk = await attempt(tx, (t) => t.execute(sql.raw(`update activity_records set note = 'edit biasa' where id = '${child}'`)));
    // organisasi lain / peran lain: tidak bisa menautkan, tidak bisa membaca
    await actAs(tx, tskB, "TSK_ADMIN", adminB);
    ur.crossOrgLink = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_records (organization_id, created_by, author_id, kind, record_date, work_type, action_taken, continues_record_id) values ('${tskB}', '${adminB}', '${adminB}', 'daily_work', current_date, 'interview', 'x', '${parent}')`)));
    await actAs(tx, lpk1.id, "LPK_ADMIN", lpkAdminUser.id);
    ur.lpkLink = await attempt(tx, (t) => t.execute(sql.raw(`insert into activity_records (organization_id, created_by, author_id, kind, record_date, work_type, action_taken, continues_record_id) values ('${tsk.id}', '${lpkAdminUser.id}', '${lpkAdminUser.id}', 'daily_work', current_date, 'interview', 'x', '${parent}')`)));
    const readers: Array<[string, string, string | null, string | null]> = [
      ["staffA", tsk.id, "TSK_STAFF", staffUser.id], ["adminA", tsk.id, "TSK_ADMIN", tskAdminUser.id], ["tskB", tskB, "TSK_ADMIN", adminB],
      ["lpkAdmin", lpk1.id, "LPK_ADMIN", lpkAdminUser.id], ["sensei", lpk1.id, "LPK_SENSEI", senseiUser.id], ["superAdmin", platformOrg.id, "SUPER_ADMIN", null], ["roleNull", tsk.id, null, null],
    ];
    for (const [who, org, role, uid] of readers) {
      await actAs(tx, org, role, uid);
      ur[`read/${who}`] = await num(tx, `select count(*)::int as n from activity_records where continues_record_id = '${parent}'`);
    }
  });
  const E2 = (v: unknown) => typeof v === "string" && v.length > 0;
  check(
    "Lanjutkan catatan: catatan lanjutan sah (pekerja sama, asal aktif) tersimpan; pekerja berbeda ditolak saat commit; asal yang dibatalkan, tidak ada, atau menunjuk diri sendiri ditolak",
    ur.valid === null && ur.validCount === 1 && /pekerja yang sama/.test(String(ur.otherWorker)) && /sudah dibatalkan|tidak ada/.test(String(ur.voidParent)) && /tidak ada|dibatalkan/.test(String(ur.missingParent)) && E2(ur.selfRef),
    JSON.stringify([ur.valid, ur.validCount, String(ur.otherWorker).slice(0, 60), String(ur.voidParent).slice(0, 50), String(ur.missingParent).slice(0, 50), String(ur.selfRef).slice(0, 50)]),
  );
  check(
    "Lanjutkan catatan: continues_record_id terkunci setelah dibuat (ubah/kosongkan ditolak), kolom lain tetap bisa diedit; TSK lain dan LPK tidak bisa menautkan ke catatan TSK ini",
    /tidak bisa diganti/.test(String(ur.lockedChange)) && /tidak bisa diganti/.test(String(ur.lockedClear)) && ur.editOtherFieldOk === null && E2(ur.crossOrgLink) && E2(ur.lpkLink),
    JSON.stringify([String(ur.lockedChange).slice(0, 50), String(ur.lockedClear).slice(0, 50), ur.editOtherFieldOk, String(ur.crossOrgLink).slice(0, 50), String(ur.lpkLink).slice(0, 50)]),
  );
  check(
    "Lanjutkan catatan: rantai hanya terbaca staf TSK organisasi pemilik; TSK lain, LPK_ADMIN, sensei, super admin, dan peran null membaca 0 baris",
    ur["read/staffA"] === 1 && ur["read/adminA"] === 1 && ["tskB", "lpkAdmin", "sensei", "superAdmin", "roleNull"].every((w) => ur[`read/${w}`] === 0),
    JSON.stringify(Object.fromEntries(Object.entries(ur).filter(([k]) => k.startsWith("read/")))),
  );

  // --- V. Penanggung jawab pekerja (T-010): baca = staf TSK organisasi sama; tulis = TSK_ADMIN; append-only (tanpa UPDATE/DELETE); staf harus staf TSK organisasi sama; LPK/sensei/TSK lain tidak melihat ---
  const vr: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const [co] = (await tx.execute(sql`select id::text as id from client_companies where org_id = ${tsk.id}::uuid order by id limit 1`)).rows as Array<{ id: string }>;
    const [pl] = (await tx.execute(sql`select id::text as id from placements where org_id = ${tsk.id}::uuid and status = 'ACTIVE' order by id limit 1`)).rows as Array<{ id: string }>;
    const ins = (org: string, by: string, target: { company?: string; placement?: string }, staff: string | null) =>
      sql.raw(`insert into responsible_assignments (organization_id, created_by, company_id, placement_id, staff_id, effective_from) values ('${org}', '${by}', ${target.company ? `'${target.company}'` : "null"}, ${target.placement ? `'${target.placement}'` : "null"}, ${staff ? `'${staff}'` : "null"}, current_date) returning id::text as id`);
    // admin TSK menulis; staf TSK tidak
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const first = ((await tx.execute(ins(tsk.id, tskAdminUser.id, { company: co.id }, staffUser.id))).rows[0] as { id: string }).id;
    vr.placementOk = await attempt(tx, (t) => t.execute(ins(tsk.id, tskAdminUser.id, { placement: pl.id }, staff2.id)));
    vr.clearOk = await attempt(tx, (t) => t.execute(ins(tsk.id, tskAdminUser.id, { placement: pl.id }, null)));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    vr.staffInsert = await attempt(tx, (t) => t.execute(ins(tsk.id, staffUser.id, { company: co.id }, staffUser.id)));
    vr.staffReads = await num(tx, `select count(*)::int as n from responsible_assignments`);
    // append-only: tanpa UPDATE/DELETE bahkan untuk admin
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    vr.update = await attempt(tx, (t) => t.execute(sql.raw(`update responsible_assignments set staff_id = null where id = '${first}'`)));
    vr.delete = await attempt(tx, (t) => t.execute(sql.raw(`delete from responsible_assignments where id = '${first}'`)));
    // penjaga: staf lintas organisasi / bukan staf TSK, target organisasi lain, cakupan ganda/kosong, pembuat tidak bisa dipalsukan
    vr.staffOtherOrg = await attempt(tx, (t) => t.execute(ins(tsk.id, tskAdminUser.id, { company: co.id }, adminB)));
    vr.staffIsLpk = await attempt(tx, (t) => t.execute(ins(tsk.id, tskAdminUser.id, { company: co.id }, lpkAdminUser.id)));
    vr.bothScopes = await attempt(tx, (t) => t.execute(ins(tsk.id, tskAdminUser.id, { company: co.id, placement: pl.id }, staffUser.id)));
    vr.noScope = await attempt(tx, (t) => t.execute(ins(tsk.id, tskAdminUser.id, {}, staffUser.id)));
    const spoof = ((await tx.execute(ins(tsk.id, staffUser.id, { company: co.id }, tskAdminUser.id))).rows[0] as { id: string }).id; // created_by dipalsukan = staf
    vr.createdByForced = await num(tx, `select count(*)::int as n from responsible_assignments where id = '${spoof}' and created_by = '${tskAdminUser.id}'`);
    await actAs(tx, tskB, "TSK_ADMIN", adminB);
    vr.otherOrgTarget = await attempt(tx, (t) => t.execute(ins(tskB, adminB, { company: co.id }, adminB))); // perusahaan milik TSK A
    vr.otherOrgIntoA = await attempt(tx, (t) => t.execute(ins(tsk.id, adminB, { company: co.id }, tskAdminUser.id)));
    for (const [who, org, role, uid] of [["tskB", tskB, "TSK_ADMIN", adminB], ["lpkAdmin", lpk1.id, "LPK_ADMIN", lpkAdminUser.id], ["sensei", lpk1.id, "LPK_SENSEI", senseiUser.id], ["superAdmin", platformOrg.id, "SUPER_ADMIN", null], ["roleNull", tsk.id, null, null]] as const) {
      await actAs(tx, org, role, uid);
      vr[`read/${who}`] = await num(tx, `select count(*)::int as n from responsible_assignments`);
      vr[`insert/${who}`] = who === "tskB" ? "skip" : await attempt(tx, (t) => t.execute(ins(tsk.id, uid ?? tskAdminUser.id, { company: co.id }, tskAdminUser.id)));
    }
  });
  const E3 = (v: unknown) => typeof v === "string" && v.length > 0 && v !== "skip";
  check(
    "Penanggung jawab: TSK_ADMIN menulis (perusahaan, pekerja, dan mengosongkan); TSK_STAFF membaca tetapi tidak menulis; riwayat append-only (UPDATE dan DELETE ditolak, juga untuk admin)",
    vr.placementOk === null && vr.clearOk === null && E3(vr.staffInsert) && Number(vr.staffReads) >= 3 && E3(vr.update) && E3(vr.delete),
    JSON.stringify([vr.placementOk, vr.clearOk, String(vr.staffInsert).slice(0, 40), vr.staffReads, String(vr.update).slice(0, 40), String(vr.delete).slice(0, 40)]),
  );
  check(
    "Penanggung jawab: penjaga trigger: staf harus staf TSK organisasi yang sama (organisasi lain dan LPK ditolak), target harus milik organisasi yang sama, tepat satu cakupan, created_by selalu pengguna sesi",
    /bukan staf TSK/.test(String(vr.staffOtherOrg)) && /bukan staf TSK/.test(String(vr.staffIsLpk)) && /scope_check/.test(String(vr.bothScopes)) && /scope_check|penempatan bukan milik/.test(String(vr.noScope)) && vr.createdByForced === 1 && E3(vr.otherOrgTarget) && E3(vr.otherOrgIntoA),
    JSON.stringify([String(vr.staffOtherOrg).slice(0, 40), String(vr.staffIsLpk).slice(0, 40), String(vr.bothScopes).slice(0, 50), String(vr.noScope).slice(0, 50), vr.createdByForced, String(vr.otherOrgTarget).slice(0, 50), String(vr.otherOrgIntoA).slice(0, 50)]),
  );
  check(
    "Penanggung jawab: TSK lain, LPK_ADMIN, sensei, super admin, dan peran null membaca 0 baris dan tidak bisa menulis",
    ["tskB", "lpkAdmin", "sensei", "superAdmin", "roleNull"].every((w) => vr[`read/${w}`] === 0) && ["lpkAdmin", "sensei", "superAdmin", "roleNull"].every((w) => E3(vr[`insert/${w}`])),
    JSON.stringify(Object.fromEntries(Object.entries(vr).filter(([k]) => k.startsWith("read/") || k.startsWith("insert/")).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 30) : v]))),
  );

  // --- W. Form 5-5 di wawancara berkala (T-009; migration 0024): kolom method/responder_role/form55 dijaga CHECK, ikut riwayat versi (snapshot memuat form55 lama), tertutup bagi LPK/sensei/TSK lain ---
  const wr: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    const [vis] = (await tx.execute(sql`select p.candidate_id::text as id from placements p where p.status = 'ACTIVE' limit 1`)).rows as Array<{ id: string }>;
    const form = (n: number) => JSON.stringify({ v: 1, items: { "work.1": { a: "ok", text: "" } }, nonconformity: false, special: `catatan-${n}`, response: null, createdOn: null }).replace(/'/g, "''");
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    const ins = `insert into periodic_interviews (organization_id, created_by, candidate_id, period_month, result_status, reason, method, responder_role, responder_title, form55) values ('${tsk.id}', '${staffUser.id}', '${vis.id}', '2020-02-01', 'no_issue', 'agency', 'online', 'support_staff', 'staf', '${form(1)}'::jsonb) returning id::text as id`;
    const id = ((await tx.execute(sql.raw(ins))).rows[0] as { id: string }).id;
    wr.insert = await num(tx, `select count(*)::int as n from periodic_interviews where id = '${id}' and method = 'online' and responder_role = 'support_staff' and form55 ->> 'special' = 'catatan-1'`);
    await tx.execute(sql.raw(`update periodic_interviews set form55 = '${form(2)}'::jsonb, method = 'in_person' where id = '${id}'`));
    wr.snapshot = await num(tx, `select count(*)::int as n from activity_revisions where entity_type = 'periodic_interview' and entity_id = '${id}' and version_no = 1 and snapshot -> 'form55' ->> 'special' = 'catatan-1' and snapshot ->> 'method' = 'online'`);
    wr.version = await num(tx, `select version_no::int as n from periodic_interviews where id = '${id}'`);
    wr.badMethod = await attempt(tx, (t) => t.execute(sql.raw(`update periodic_interviews set method = 'telepon' where id = '${id}'`)));
    wr.badRole = await attempt(tx, (t) => t.execute(sql.raw(`update periodic_interviews set responder_role = 'bos' where id = '${id}'`)));
    wr.tooBig = await attempt(tx, (t) => t.execute(sql.raw(`update periodic_interviews set form55 = jsonb_build_object('x', repeat('a', 20001)) where id = '${id}'`)));
    wr.noWhere = await attempt(tx, (t) => t.execute(sql.raw(`update periodic_interviews set method = 'online', responder_role = 'bogus'`)));
    for (const [who, org, role, uid] of [["tskB", tskB, "TSK_ADMIN", adminB], ["lpkAdmin", lpk1.id, "LPK_ADMIN", lpkAdminUser.id], ["sensei", lpk1.id, "LPK_SENSEI", senseiUser.id], ["superAdmin", platformOrg.id, "SUPER_ADMIN", null], ["roleNull", tsk.id, null, null]] as const) {
      await actAs(tx, org, role, uid);
      wr[`read/${who}`] = await num(tx, `select count(*)::int as n from periodic_interviews where id = '${id}'`);
      wr[`write/${who}`] = await attempt(tx, (t) => t.execute(sql.raw(`update periodic_interviews set form55 = '${form(3)}'::jsonb`))); // 0 baris terlihat -> tidak mengubah apa pun
    }
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    wr.unchanged = await num(tx, `select count(*)::int as n from periodic_interviews where id = '${id}' and form55 ->> 'special' = 'catatan-2'`);
  });
  check(
    "Form 5-5: staf TSK menyimpan method/responder_role/form55; edit menaikkan versi dan snapshot riwayat memuat form55 + method LAMA",
    wr.insert === 1 && wr.snapshot === 1 && wr.version === 2,
    JSON.stringify([wr.insert, wr.snapshot, wr.version]),
  );
  check(
    "Form 5-5: CHECK menolak method di luar (in_person/online), responder_role di luar (support_manager/support_staff), dan form55 > 20000 karakter (juga UPDATE tanpa WHERE)",
    /method_check/.test(String(wr.badMethod)) && /responder_role_check/.test(String(wr.badRole)) && /form55_size_check/.test(String(wr.tooBig)) && /responder_role_check/.test(String(wr.noWhere)),
    JSON.stringify([String(wr.badMethod).slice(0, 60), String(wr.badRole).slice(0, 60), String(wr.tooBig).slice(0, 60), String(wr.noWhere).slice(0, 60)]),
  );
  check(
    "Form 5-5: TSK lain, LPK_ADMIN, sensei, super admin, dan peran null membaca 0 baris wawancara dan form55 tetap utuh setelah UPDATE tanpa WHERE mereka",
    ["tskB", "lpkAdmin", "sensei", "superAdmin", "roleNull"].every((w) => wr[`read/${w}`] === 0) && wr.unchanged === 1,
    JSON.stringify(Object.fromEntries(Object.entries(wr).filter(([k]) => k.startsWith("read/") || k === "unchanged"))),
  );

  // --- X. Kartu izin tinggal 在留カード (T-017): baca = staf TSK organisasi sama; tulis = TSK_ADMIN atau 担当 efektif pekerja (card_editor, logika sama dengan effectiveResponsible);
  // tanpa DELETE; pengganti kartu atomik; kartu diterima final; LPK/sensei/super admin/null/TSK lain 0 baris ---
  const xr: Record<string, unknown> = {};
  await sandbox(async (tx) => {
    const tskB = await makeTskB(tx);
    const adminB = await makeUser(tx, tskB, "TSK_ADMIN");
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const infos = (await tx.execute(sql`select p.candidate_id::text as cid, p.id::text as pid, s.company_id::text as coid, c.field_id::text as fid from placements p join client_sites s on s.id = p.site_id join candidates c on c.id = p.candidate_id where p.status = 'ACTIVE' and p.org_id = ${tsk.id}::uuid order by p.id limit 3`)).rows as Array<{ cid: string; pid: string; coid: string; fid: string }>;
    const [a, b2] = infos;
    const card = (by: string, cid: string, fid: string, cols: Record<string, string> = {}) => {
      const all: Record<string, string> = { organization_id: `'${tsk.id}'`, created_by: `'${by}'`, candidate_id: `'${cid}'`, skill_field_id: `'${fid}'`, expiry_date: "(current_date + 100)", ...cols };
      return sql.raw(`insert into residence_cards (${Object.keys(all).join(", ")}) values (${Object.values(all).join(", ")}) returning id::text as id`);
    };
    const assign = (by: string, target: { placement?: string; company?: string }, staff: string | null) =>
      sql.raw(`insert into responsible_assignments (organization_id, created_by, company_id, placement_id, staff_id, effective_from, created_at) values ('${tsk.id}', '${by}', ${target.company ? `'${target.company}'` : "null"}, ${target.placement ? `'${target.placement}'` : "null"}, ${staff ? `'${staff}'` : "null"}, current_date, clock_timestamp())`);
    const idOf = async (q: ReturnType<typeof card>) => ((await tx.execute(q)).rows[0] as { id: string }).id;

    // --- 担当 = staffUser (per penempatan): 担当 menulis; staf lain TIDAK; Admin menulis
    await tx.execute(assign(tskAdminUser.id, { placement: a.pid }, staffUser.id));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    const id1 = await idOf(card(tskAdminUser.id, a.cid, a.fid, { created_by: `'${tskAdminUser.id}'` })); // created_by dipalsukan = admin
    xr.createdByForced = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}' and created_by = '${staffUser.id}'`);
    await tx.execute(sql.raw(`update residence_cards set note = 'dari-担当' where id = '${id1}'`));
    xr.editorUpdate = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}' and note = 'dari-担当'`);
    await actAs(tx, tsk.id, "TSK_STAFF", staff2!.id);
    xr.otherInsert = await attempt(tx, (t) => t.execute(card(staff2!.id, a.cid, a.fid)));
    await tx.execute(sql.raw(`update residence_cards set note = 'bukan-担当' where id = '${id1}'`));
    await tx.execute(sql.raw(`update residence_cards set note = 'bukan-担当-tanpa-where'`));
    // UPDATE tanpa WHERE oleh staf lain hanya boleh mengubah kartu pekerja yang IA 担当 (mis. kartu seed milik pekerja lain), TIDAK kartu pekerja `a`
    xr.otherUpdateBlocked = await num(tx, `select count(*)::int as n from residence_cards where candidate_id = '${a.cid}' and note like 'bukan-担当%'`);
    xr.otherReads = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}'`); // membaca boleh
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const id2 = await idOf(card(tskAdminUser.id, b2.cid, b2.fid)); // Admin menulis untuk pekerja mana pun
    await tx.execute(sql.raw(`update residence_cards set note = 'dari-admin' where id = '${id1}'`));
    xr.adminUpdate = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}' and note = 'dari-admin'`);

    // --- pergantian 担当: 担当 lama tidak bisa menulis lagi, 担当 baru bisa
    await tx.execute(assign(tskAdminUser.id, { placement: a.pid }, staff2!.id));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    await tx.execute(sql.raw(`update residence_cards set note = 'staf-lama' where id = '${id1}'`));
    xr.oldEditorBlocked = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}' and note = 'staf-lama'`);
    xr.oldEditorInsert = await attempt(tx, (t) => t.execute(card(staffUser.id, a.cid, a.fid)));
    await actAs(tx, tsk.id, "TSK_STAFF", staff2!.id);
    await tx.execute(sql.raw(`update residence_cards set note = 'staf-baru' where id = '${id1}'`));
    xr.newEditor = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}' and note = 'staf-baru'`);
    // --- dikosongkan di tingkat penempatan = ikut perusahaan: penetapan perusahaan = staffUser
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    await tx.execute(assign(tskAdminUser.id, { placement: a.pid }, null));
    await tx.execute(assign(tskAdminUser.id, { company: a.coid }, staffUser.id));
    await actAs(tx, tsk.id, "TSK_STAFF", staffUser.id);
    await tx.execute(sql.raw(`update residence_cards set note = 'ikut-perusahaan' where id = '${id1}'`));
    xr.companyFallback = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}' and note = 'ikut-perusahaan'`);
    await actAs(tx, tsk.id, "TSK_STAFF", staff2!.id);
    await tx.execute(sql.raw(`update residence_cards set note = 'tidak-boleh' where id = '${id1}'`));
    xr.companyFallbackOther = await num(tx, `select count(*)::int as n from residence_cards where id = '${id1}' and note = 'tidak-boleh'`);
    // kesetaraan card_editor SQL vs effectiveResponsible TS pada SEMUA penempatan aktif seed + penetapan di atas
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    const today = String(((await tx.execute(sql`select (now() at time zone 'Asia/Tokyo')::date::text as d`)).rows[0] as { d: string }).d);
    const pls = (await tx.execute(sql`select p.candidate_id::text as cid, p.id::text as pid, s.company_id::text as coid from placements p join client_sites s on s.id = p.site_id where p.status = 'ACTIVE' and p.org_id = ${tsk.id}::uuid`)).rows as Array<{ cid: string; pid: string; coid: string }>;
    const asg = (await tx.execute(sql`select placement_id::text as pid, company_id::text as coid, staff_id::text as staff, effective_from::text as ef, created_at::text as ca from responsible_assignments where organization_id = ${tsk.id}::uuid`)).rows as Array<{ pid: string | null; coid: string | null; staff: string | null; ef: string; ca: string }>;
    const mism: string[] = [];
    for (const who of [staffUser.id, staff2!.id, tskAdminUser.id]) {
      await actAs(tx, tsk.id, "TSK_STAFF", who);
      for (const pl of pls) {
        const rows = (list: typeof asg) => list.map((r) => ({ staffId: r.staff, effectiveFrom: r.ef, createdAt: r.ca }));
        const expected = effectiveResponsible(rows(asg.filter((r) => r.pid === pl.pid)), rows(asg.filter((r) => r.coid === pl.coid)), today).staffId === who;
        const got = ((await tx.execute(sql.raw(`select card_editor('${pl.cid}'::uuid) as ok`))).rows[0] as { ok: boolean }).ok;
        if (expected !== got) mism.push(`${who.slice(0, 4)}:${pl.cid.slice(0, 4)} ts=${expected} sql=${got}`);
      }
    }
    xr.equiv = { n: pls.length, mism };
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);

    // --- tanpa DELETE; CHECK dan trigger penjaga
    xr.noDelete = await attempt(tx, (t) => t.execute(sql.raw(`delete from residence_cards where id = '${id1}'`)));
    const bad = (cols: Record<string, string>) => attempt(tx, (t) => t.execute(card(tskAdminUser.id, a.cid, a.fid, cols)));
    xr.badStatus = await bad({ renewal_status: "'bogus'" });
    xr.badResidence = await bad({ residence_status: "'ssw2'" });
    xr.appliedNoDate = await bad({ renewal_status: "'applied'" });
    xr.receivedNoBy = await bad({ renewal_status: "'received'", applied_on: "(current_date - 10)", received_on: "(current_date - 1)" });
    xr.receivedOnWrongStatus = await bad({ renewal_status: "'preparing'", received_on: "(current_date - 1)" });
    xr.datesOrder = await bad({ renewal_status: "'received'", applied_on: "(current_date - 1)", received_on: "(current_date - 10)", received_by: "'staff'" });
    xr.futureApplied = await bad({ renewal_status: "'applied'", applied_on: "(current_date + 3)" });
    xr.badPeriod = await bad({ period_months: "61" });
    xr.handoverWorker = await bad({ renewal_status: "'received'", applied_on: "(current_date - 10)", received_on: "(current_date - 1)", received_by: "'worker'", handed_over_on: "current_date" });
    xr.badBy = await bad({ renewal_status: "'received'", applied_on: "(current_date - 10)", received_on: "(current_date - 1)", received_by: "'pos'" });
    xr.noPlacement = await attempt(tx, (t) => t.execute(card(tskAdminUser.id, outsider.id, a.fid)));
    xr.noteTooLong = await bad({ note: "repeat('x', 2001)" });
    // T-018 (migration 0026): tanggal 追加資料 dan 不許可 wajib untuk statusnya, tidak lebih awal dari pengajuan, tidak di masa depan
    xr.additionalNoDate = await bad({ renewal_status: "'additional_docs'", applied_on: "(current_date - 10)" });
    xr.rejectedNoDate = await bad({ renewal_status: "'rejected'", applied_on: "(current_date - 10)" });
    xr.additionalBeforeApplied = await bad({ renewal_status: "'additional_docs'", applied_on: "(current_date - 5)", additional_docs_on: "(current_date - 10)" });
    xr.rejectedFuture = await bad({ renewal_status: "'rejected'", applied_on: "(current_date - 5)", rejected_on: "(current_date + 3)" });
    xr.additionalOk = await attempt(tx, (t) => t.execute(card(tskAdminUser.id, a.cid, a.fid, { renewal_status: "'additional_docs'", applied_on: "(current_date - 10)", additional_docs_on: "(current_date - 3)" })));
    xr.rejectedOk = await attempt(tx, (t) => t.execute(card(tskAdminUser.id, a.cid, a.fid, { renewal_status: "'rejected'", applied_on: "(current_date - 10)", rejected_on: "(current_date - 2)" })));

    // --- "Terima kartu baru" atomik: kartu diterima wajib punya pengganti pada akhir transaksi (dicek tertunda)
    const recv = `update residence_cards set renewal_status = 'received', applied_on = current_date - 10, received_on = current_date - 1, received_by = 'staff' where id = '${id2}'`;
    await tx.execute(sql.raw(recv));
    const newCard = (prev: string, expiry: string) => card(tskAdminUser.id, b2.cid, b2.fid, { previous_card_id: `'${prev}'`, expiry_date: expiry });
    const idNew = await idOf(newCard(id2, "(current_date + 465)"));
    xr.atomicOk = await attempt(tx, (t) => t.execute(sql.raw("set constraints residence_cards_successor_check immediate")));
    await tx.execute(sql.raw("set constraints residence_cards_successor_check deferred"));
    xr.atomicMissing = await attempt(tx, async (t) => {
      await t.execute(sql.raw(`update residence_cards set renewal_status = 'received', applied_on = current_date - 10, received_on = current_date - 1, received_by = 'worker' where id = '${id1}'`));
      await t.execute(sql.raw("set constraints residence_cards_successor_check immediate"));
    });
    xr.successorNotReceived = await attempt(tx, (t) => t.execute(newCard(id1, "(current_date + 465)"))); // id1 belum diterima
    xr.secondSuccessor = await attempt(tx, (t) => t.execute(newCard(id2, "(current_date + 500)"))); // sudah punya pengganti aktif
    xr.otherCandidatePrev = await attempt(tx, (t) => t.execute(card(tskAdminUser.id, a.cid, a.fid, { previous_card_id: `'${id2}'`, expiry_date: "(current_date + 500)" })));
    // kartu pengganti harus lebih akhir: pakai kartu diterima lain (id3)
    const id3 = await idOf(card(tskAdminUser.id, b2.cid, b2.fid, { expiry_date: "(current_date + 30)" }));
    await tx.execute(sql.raw(`update residence_cards set renewal_status = 'received', applied_on = current_date - 10, received_on = current_date - 1, received_by = 'worker' where id = '${id3}'`));
    xr.successorNotLater = await attempt(tx, (t) => t.execute(newCard(id3, "(current_date + 30)")));
    // kartu diterima final (kecuali tanggal serah, catatan); pengganti tidak bisa dibatalkan; kartu yang punya pengganti tidak bisa dibatalkan
    xr.receivedLocked = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set expiry_date = expiry_date + 1 where id = '${id2}'`)));
    xr.receivedLockedStatus = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set renewal_status = 'preparing', received_on = null, received_by = null where id = '${id2}'`)));
    xr.receivedLockedDates = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set additional_docs_on = current_date - 20 where id = '${id2}'`)));
    xr.handoverOk = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set handed_over_on = current_date, note = 'diserahkan' where id = '${id2}'`)));
    xr.voidWithSuccessor = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set status = 'void', void_reason = 'salah' where id = '${id2}'`)));
    xr.voidSuccessor = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set status = 'void', void_reason = 'salah' where id = '${idNew}'`)));
    xr.successorEditable = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set expiry_date = expiry_date + 1 where id = '${idNew}'`)));
    // pembatalan kartu biasa: butuh alasan, final
    const id4 = await idOf(card(tskAdminUser.id, a.cid, a.fid));
    xr.voidNoReason = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set status = 'void' where id = '${id4}'`)));
    xr.voidOk = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set status = 'void', void_reason = 'dobel' where id = '${id4}'`)));
    xr.voidFinal = await attempt(tx, (t) => t.execute(sql.raw(`update residence_cards set note = 'lagi' where id = '${id4}'`)));
    xr.voidMeta = await num(tx, `select count(*)::int as n from residence_cards where id = '${id4}' and voided_by = '${tskAdminUser.id}' and voided_at is not null`);
    // riwayat edit otomatis (trigger): versi naik, snapshot memuat nilai SEBELUM
    xr.revisions = await num(tx, `select count(*)::int as n from activity_revisions where entity_type = 'residence_card' and entity_id = '${id1}'`);
    xr.version = await num(tx, `select version_no::int as n from residence_cards where id = '${id1}'`);
    xr.firstSnapshot = await num(tx, `select count(*)::int as n from activity_revisions where entity_type = 'residence_card' and entity_id = '${id1}' and version_no = 1 and snapshot ->> 'note' is null`);

    // --- peran lain: 0 baris dan tidak bisa menulis (UPDATE tanpa WHERE tidak mengubah apa pun)
    const [owner] = (await tx.execute(sql`select c.organization_id::text as org from candidates c where c.id = ${a.cid}::uuid`)).rows as Array<{ org: string }>;
    for (const [who, org, role, uid] of [["tskB", tskB, "TSK_ADMIN", adminB], ["lpkAdmin", owner.org, "LPK_ADMIN", lpkAdminUser.id], ["sensei", owner.org, "LPK_SENSEI", senseiUser.id], ["superAdmin", platformOrg.id, "SUPER_ADMIN", null], ["roleNull", tsk.id, null, null]] as const) {
      await actAs(tx, org, role, uid);
      xr[`read/${who}`] = await num(tx, `select count(*)::int as n from residence_cards`);
      xr[`insert/${who}`] = await attempt(tx, (t) => t.execute(card(uid ?? tskAdminUser.id, a.cid, a.fid)));
      await tx.execute(sql.raw(`update residence_cards set note = 'diretas-${who}'`));
    }
    await actAs(tx, tsk.id, "TSK_ADMIN", tskAdminUser.id);
    xr.untouched = await num(tx, `select count(*)::int as n from residence_cards where note like 'diretas-%'`);
    xr.adminReads = await num(tx, `select count(*)::int as n from residence_cards where status = 'active'`);
  });
  xr.fns = await ownerDb.execute(sql`select count(*)::int as n from pg_proc where proname in ('candidates_block_delete', 'candidate_delete_summary') and prosrc like '%residence_cards%'`).then((r) => Number((r.rows[0] as { n: number }).n));
  const X3 = (v: unknown) => typeof v === "string" && v.length > 0;
  check(
    "Kartu izin tinggal: 担当 efektif dan TSK_ADMIN menulis; staf lain TIDAK (INSERT ditolak, UPDATE dengan/ tanpa WHERE 0 baris) tetapi boleh membaca; created_by selalu pengguna sesi",
    xr.createdByForced === 1 && xr.editorUpdate === 1 && X3(xr.otherInsert) && xr.otherUpdateBlocked === 0 && xr.otherReads === 1 && xr.adminUpdate === 1,
    JSON.stringify([xr.createdByForced, xr.editorUpdate, String(xr.otherInsert).slice(0, 50), xr.otherUpdateBlocked, xr.otherReads, xr.adminUpdate]),
  );
  check(
    "Kartu izin tinggal: pergantian 担当 (担当 lama tidak bisa menulis lagi, yang baru bisa); dikosongkan di tingkat penempatan = ikut penetapan perusahaan",
    xr.oldEditorBlocked === 0 && X3(xr.oldEditorInsert) && xr.newEditor === 1 && xr.companyFallback === 1 && xr.companyFallbackOther === 0,
    JSON.stringify([xr.oldEditorBlocked, String(xr.oldEditorInsert).slice(0, 40), xr.newEditor, xr.companyFallback, xr.companyFallbackOther]),
  );
  const eqv = xr.equiv as { n: number; mism: string[] };
  check(
    "Kartu izin tinggal: card_editor (SQL) sama dengan effectiveResponsible (TS) untuk SEMUA penempatan aktif dan tiga staf",
    eqv.n >= 3 && eqv.mism.length === 0,
    JSON.stringify(eqv),
  );
  check(
    "Kartu izin tinggal: tanpa DELETE; CHECK dan trigger menolak status/jenis di luar daftar, pengajuan tanpa tanggal, diterima tanpa penerima, tanggal terbalik atau di masa depan, masa tinggal di luar 1-60, serah oleh pekerja, penerima tak dikenal, catatan > 2000, pekerja tanpa penempatan, serta 追加資料/不許可 tanpa tanggal, lebih awal dari pengajuan, atau di masa depan (yang sah lolos)",
    [xr.noDelete, xr.badStatus, xr.badResidence, xr.appliedNoDate, xr.receivedNoBy, xr.receivedOnWrongStatus, xr.datesOrder, xr.futureApplied, xr.badPeriod, xr.handoverWorker, xr.badBy, xr.noPlacement, xr.noteTooLong, xr.additionalNoDate, xr.rejectedNoDate, xr.additionalBeforeApplied, xr.rejectedFuture].every(X3) && xr.additionalOk === null && xr.rejectedOk === null,
    JSON.stringify([xr.noDelete, xr.badStatus, xr.badResidence, xr.appliedNoDate, xr.receivedNoBy, xr.receivedOnWrongStatus, xr.datesOrder, xr.futureApplied, xr.badPeriod, xr.handoverWorker, xr.badBy, xr.noPlacement, xr.noteTooLong].map((v) => String(v).slice(0, 28))),
  );
  check(
    "Kartu izin tinggal: terima kartu baru atomik (diterima + pengganti dalam satu transaksi lolos; diterima tanpa pengganti ditolak saat commit); pengganti hanya dari kartu yang diterima, sekali, tanggal habis lebih akhir",
    xr.atomicOk === null && /kartu penggantinya/.test(String(xr.atomicMissing)) && /belum diterima/.test(String(xr.successorNotReceived)) && X3(xr.secondSuccessor) && X3(xr.otherCandidatePrev) && /lebih akhir/.test(String(xr.successorNotLater)),
    JSON.stringify([xr.atomicOk, String(xr.atomicMissing).slice(0, 50), String(xr.successorNotReceived).slice(0, 40), String(xr.secondSuccessor).slice(0, 40), String(xr.otherCandidatePrev).slice(0, 40), String(xr.successorNotLater).slice(0, 40)]),
  );
  check(
    "Kartu izin tinggal: kartu diterima final (hanya tanggal serah dan catatan bisa berubah); kartu yang punya pengganti dan pengganti dari kartu diterima tidak bisa dibatalkan; data pengganti masih bisa diperbaiki; pembatalan butuh alasan, final, dan tercatat pelakunya",
    /tidak bisa diubah/.test(String(xr.receivedLocked)) && /tidak bisa diubah/.test(String(xr.receivedLockedStatus)) && /tidak bisa diubah/.test(String(xr.receivedLockedDates)) && xr.handoverOk === null && /pengganti/.test(String(xr.voidWithSuccessor)) && /tidak bisa dibatalkan/.test(String(xr.voidSuccessor)) && xr.successorEditable === null
      && X3(xr.voidNoReason) && xr.voidOk === null && /tidak bisa diubah lagi/.test(String(xr.voidFinal)) && xr.voidMeta === 1,
    JSON.stringify([String(xr.receivedLocked).slice(0, 30), String(xr.receivedLockedStatus).slice(0, 30), xr.handoverOk, String(xr.voidWithSuccessor).slice(0, 30), String(xr.voidSuccessor).slice(0, 30), xr.successorEditable, String(xr.voidNoReason).slice(0, 30), xr.voidOk, String(xr.voidFinal).slice(0, 30), xr.voidMeta]),
  );
  check(
    "Kartu izin tinggal: riwayat edit otomatis (versi naik, snapshot memuat nilai SEBELUM); hapus kandidat memeriksa kartu (fungsi blokir + ringkasan)",
    Number(xr.revisions) >= 4 && xr.version === Number(xr.revisions) + 1 && xr.firstSnapshot === 1 && xr.fns === 2,
    JSON.stringify([xr.revisions, xr.version, xr.firstSnapshot, xr.fns]),
  );
  check(
    "Kartu izin tinggal: TSK lain, LPK_ADMIN, sensei, super admin, dan peran null membaca 0 baris, tidak bisa menulis, dan UPDATE tanpa WHERE mereka tidak mengubah apa pun",
    ["tskB", "lpkAdmin", "sensei", "superAdmin", "roleNull"].every((w) => xr[`read/${w}`] === 0 && X3(xr[`insert/${w}`])) && xr.untouched === 0 && Number(xr.adminReads) >= 3,
    JSON.stringify([...Object.entries(xr).filter(([k]) => k.startsWith("read/") || k.startsWith("insert/")).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 24) : v]), xr.untouched, xr.adminReads]),
  );

  await pool.end();
  await ownerPool.end();
  console.log(failures === 0 ? "\nSemua pemeriksaan RLS lulus." : `\n${failures} pemeriksaan GAGAL.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exit(1);
});
