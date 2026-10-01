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
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { assertTestDatabase } from "./db-guard";
import { createDb, withSystem, withTenant, type Tx } from "../src/db";
import { platformOverview } from "../src/db/queries";
import { assessmentAuditEntry, noteAuditEntry } from "../src/db/audit-entries";
import {
  auditLogs,
  candidateAssessments,
  candidateCertificates,
  candidateDocuments,
  candidateEducations,
  candidateFamilyMembers,
  candidatePrivate,
  candidates,
  candidateNotes,
  candidateSelections,
  candidateStage,
  candidateWorkHistories,
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
  const hasSelection = (id: string) => seededSelections.some((s) => s.candidateId === id);

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
  const target = tskRows.find((r) => r.stage === "READY" && !hasSelection(r.id))!;
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
  const pick = (org: string, stage: string) =>
    all.find((c) => c.organizationId === org && c.stage === stage && consented(c) && !hasSelection(c.id))!;
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
      await probe("selections", w, (t) => t.update(candidateSelections).set({ decision: "REJECTED" }), async (t) => (await t.select({ id: candidateSelections.tskOrgId }).from(candidateSelections).where(eq(candidateSelections.decision, "REJECTED"))).map((r) => r.id));
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
  type Counts = { cand: number; priv: number; fam: number; edu: number; work: number; cert: number; docs: number; sel: number; notes: number; assess: number };
  await sandbox(async (tx) => {
    // Data lengkap di setiap tabel turunan untuk ready1, plus keputusan TSK yang membuka hak edit
    await tx.insert(candidatePrivate).values({ candidateId: ready1.id, nationalId: NIK });
    await tx.insert(candidateFamilyMembers).values({ candidateId: ready1.id, relation: "FATHER", name: "Ayah Uji" });
    await tx.insert(candidateEducations).values({ candidateId: ready1.id, schoolName: "SMK Uji" });
    await tx.insert(candidateWorkHistories).values({ candidateId: ready1.id, companyName: "PT Uji" });
    await tx.insert(candidateCertificates).values({ candidateId: ready1.id, type: "JLPT", levelOrField: "N4" });
    await tx.insert(candidateDocuments).values(sampleDoc(ready1.id));
    await decide(tx, ready1.id, tsk.id, "PASSED_CLIENT_INTERVIEW");
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
    const tabs = await tx.execute(sql`select distinct table_name from information_schema.columns where table_schema = 'public' and column_name = 'candidate_id' order by 1`);
    sh.leftoverPolicies = pol.rows.map((r) => `${r.tablename}.${r.policyname}`);
    sh.leftoverFns = fns.rows.map((r) => String(r.proname));
    sh.candidateTables = tabs.rows.map((r) => String(r.table_name));
  });
  const FULL_ON: Counts = { cand: 1, priv: 1, fam: 1, edu: 1, work: 1, cert: 1, docs: 1, sel: 1, notes: 2, assess: 3 };
  const ZERO: Counts = { cand: 0, priv: 0, fam: 0, edu: 0, work: 0, cert: 0, docs: 0, sel: 0, notes: 0, assess: 0 };
  const J = JSON.stringify;
  check(
    "Dibagikan: TSK melihat kandidat dan SEMUA tabel turunannya (data sensitif, keluarga, pendidikan, kerja, sertifikat, dokumen, keputusan, catatan)",
    J(sh["on1/tsk"]) === J(FULL_ON),
    J(sh["on1/tsk"]),
  );
  check(
    "Dimatikan: TSK (admin dan staf) tidak melihat apa pun di SEMUA tabel itu; LPK tetap melihat datanya sendiri",
    J(sh["off/tsk"]) === J(ZERO) && J(sh["off/tsk-staff"]) === J(ZERO) &&
      J(sh["off/lpk"]) === J({ ...FULL_ON, notes: 0, assess: 1 }),
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
  const covered = ["audit_logs", "candidate_assessments", "candidate_certificates", "candidate_documents", "candidate_educations", "candidate_family_members", "candidate_notes", "candidate_private", "candidate_selections", "candidate_work_histories"];
  check(
    "Tuntas: setiap tabel ber-candidate_id sudah tercakup tes berbagi (tabel baru ber-candidate_id harus ditambahkan ke bagian I)",
    J(sh.candidateTables) === J(covered),
    J(sh.candidateTables),
  );

  // --- J. Penilaian (candidate_assessments) ---
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

  await pool.end();
  console.log(failures === 0 ? "\nSemua pemeriksaan RLS lulus." : `\n${failures} pemeriksaan GAGAL.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exit(1);
});
