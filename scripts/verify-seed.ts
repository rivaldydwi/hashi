// Memeriksa kelengkapan data DEMO (hanya MEMBACA, aman dijalankan terhadap database mana pun, termasuk produksi demo).
// Gagal bila ada kandidat dengan kolom demo kosong, tanpa JLPT, <3 penilaian, atau tanpa dokumen; ada nilai keputusan TSK yang
// tidak muncul; filter di /candidates menghasilkan himpunan kosong atau seluruh kandidat; atau ada berkas yatim / hilang di storage.
// Filter memakai fungsi YANG SAMA dengan halaman (src/db/candidate-list.ts: parseFilters + listCandidatesFiltered).
// Pemakaian: npm run verify:seed   (butuh DATABASE_URL dan MIGRATE_DATABASE_URL; VERIFY_SKIP_FILES=1 melewati pemeriksaan berkas)

import "dotenv/config";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { createDb, withSystem, withTenant } from "../src/db";
import { listCandidatesFiltered, parseFilters } from "../src/db/candidate-list";
import { matchCandidates } from "../src/db/job-matching";
import { currentPeriod } from "../src/db/time";
import { storageRootFor } from "../src/db/demo-files";
import {
  candidateCertificates,
  candidateDocuments,
  candidateEducations,
  candidateFamilyMembers,
  candidatePrivate,
  candidateSelections,
  candidateWorkHistories,
  candidates,
  clientCompanies,
  clientSiteContacts,
  clientSiteFields,
  clientSites,
  jobOrders,
  organizations,
  placements,
  selectionDecision,
  skillFields,
  users,
  type Role,
} from "../src/db/schema";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// Kolom nullable yang BOLEH kosong di seed (dengan alasan)
const OPTIONAL_CANDIDATE_COLUMNS = new Set(["dataConsentDate", "sharedWithTskAt", "sharedWithTskBy", "japanHistoryNote"]);

function emptyColumns(table: Parameters<typeof getTableColumns>[0], rows: Array<Record<string, unknown>>, skip: Set<string> = new Set()) {
  const cols = Object.entries(getTableColumns(table)).filter(([name, c]) => !(c as { notNull: boolean }).notNull && !skip.has(name));
  const bad: string[] = [];
  rows.forEach((r, idx) => {
    for (const [name] of cols) if (r[name] === null || r[name] === undefined || r[name] === "") bad.push(`#${idx}.${name}`);
  });
  return bad;
}

async function walkFiles(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let orgs: import("node:fs").Dirent[];
  try {
    orgs = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const o of orgs.filter((e) => e.isDirectory() && UUID.test(e.name))) {
    for (const c of await readdir(path.join(root, o.name), { withFileTypes: true })) {
      if (!c.isDirectory()) continue;
      for (const f of await readdir(path.join(root, o.name, c.name))) out.add(path.join(o.name, c.name, f));
    }
  }
  return out;
}

async function main() {
  const owner = process.env.MIGRATE_DATABASE_URL;
  const app = process.env.DATABASE_URL;
  if (!owner || !app) throw new Error("MIGRATE_DATABASE_URL dan DATABASE_URL harus di-set");
  const ownerDb = createDb(owner, 2);
  const appDb = createDb(app, 2);

  // ---------- 1. Kelengkapan data (baca penuh sebagai OWNER) ----------
  const data = await withSystem(async (tx) => ({
    cands: await tx.select().from(candidates),
    privs: await tx.select().from(candidatePrivate),
    fams: await tx.select().from(candidateFamilyMembers),
    edus: await tx.select().from(candidateEducations),
    works: await tx.select().from(candidateWorkHistories),
    certs: await tx.select().from(candidateCertificates),
    docs: await tx.select().from(candidateDocuments),
    sels: await tx.select().from(candidateSelections),
    assess: (await tx.execute(sql`select candidate_id, kind, count(*)::int as n from candidate_assessments group by candidate_id, kind`)).rows as Array<{ candidate_id: string; kind: string; n: number }>,
    notes: (await tx.execute(sql`select visibility::text as v, count(*)::int as n from candidate_notes group by visibility`)).rows as Array<{ v: string; n: number }>,
    tskAssess: (await tx.execute(sql`select kind::text as k, visibility::text as v, count(*)::int as n from candidate_assessments where kind <> 'LPK_MONTHLY' group by kind, visibility`)).rows as Array<{ k: string; v: string; n: number }>,
    orgs: await tx.select().from(organizations),
    users: await tx.select({ id: users.id, org: users.organizationId, role: users.role }).from(users),
  }), ownerDb.db);

  const total = data.cands.length;
  check("Ada kandidat demo", total > 0, String(total));
  const byCand = <T extends { candidateId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.candidateId, [...(m.get(r.candidateId) ?? []), r]);
    return m;
  };
  const famBy = byCand(data.fams), eduBy = byCand(data.edus), workBy = byCand(data.works), certBy = byCand(data.certs), docBy = byCand(data.docs);
  const privBy = new Map(data.privs.map((p) => [p.candidateId, p]));
  const assessBy = new Map(data.assess.filter((a) => a.kind === "LPK_MONTHLY").map((a) => [a.candidate_id, a.n]));

  const bad = {
    cols: emptyColumns(candidates, data.cands as never, OPTIONAL_CANDIDATE_COLUMNS),
    japanNote: data.cands.filter((c) => (c.everInJapan || c.visaRejectedBefore) && !c.japanHistoryNote).map((c) => c.id),
    consent: data.cands.filter((c) => c.dataConsentDate === null).length,
    noPriv: data.cands.filter((c) => !privBy.has(c.id)).map((c) => c.id),
    privCols: emptyColumns(candidatePrivate, data.privs as never),
    fam: data.cands.filter((c) => { const f = famBy.get(c.id) ?? []; return f.length < 3 || f.length > 5 || f.filter((x) => x.isEmergencyContact).length !== 1; }).map((c) => c.id),
    famCols: emptyColumns(candidateFamilyMembers, data.fams as never),
    edu: data.cands.filter((c) => (eduBy.get(c.id)?.length ?? 0) < 2).map((c) => c.id),
    eduCols: emptyColumns(candidateEducations, data.edus as never),
    work: data.cands.filter((c) => (workBy.get(c.id)?.length ?? 0) < 1).map((c) => c.id),
    workCols: emptyColumns(candidateWorkHistories, data.works as never),
    noJlpt: data.cands.filter((c) => !(certBy.get(c.id) ?? []).some((x) => x.type === "JLPT")).map((c) => c.id),
    noSkill: data.cands.filter((c) => c.stage === "READY" && !(certBy.get(c.id) ?? []).some((x) => x.type === "SKILL_TEST")).map((c) => c.id),
    certCols: emptyColumns(candidateCertificates, data.certs as never),
    fewAssess: data.cands.filter((c) => (assessBy.get(c.id) ?? 0) < 3).map((c) => c.id),
    docs: data.cands.filter((c) => { const t = new Set((docBy.get(c.id) ?? []).map((d) => d.type)); return !["PASSPORT", "DIPLOMA", "PHOTO", "MEDICAL_CHECKUP"].every((x) => t.has(x as never)); }).map((c) => c.id),
  };
  check("Kolom kandidat (profil dasar, motivasi, fisik, Jepang) terisi untuk semua kandidat", bad.cols.length === 0 && bad.japanNote.length === 0, [...bad.cols.slice(0, 5), ...bad.japanNote.slice(0, 3)].join(", "));
  check("Tanggal formulir persetujuan kosong paling banyak untuk 1 kandidat (disengaja)", bad.consent <= 1, String(bad.consent));
  check("Data sensitif (kontak, identitas, paspor, kesehatan) lengkap untuk semua kandidat", bad.noPriv.length === 0 && bad.privCols.length === 0, [...bad.noPriv.slice(0, 3), ...bad.privCols.slice(0, 5)].join(", "));
  check("Keluarga 3-5 anggota dengan tepat satu kontak darurat, kolom terisi", bad.fam.length === 0 && bad.famCols.length === 0, [...bad.fam.slice(0, 3), ...bad.famCols.slice(0, 3)].join(", "));
  check("Pendidikan (>=2) dan riwayat kerja (>=1) terisi", bad.edu.length + bad.eduCols.length + bad.work.length + bad.workCols.length === 0, [...bad.edu, ...bad.work].slice(0, 3).join(", "));
  check("Setiap kandidat punya JLPT; kandidat Siap seleksi punya ujian skill; kolom sertifikat terisi", bad.noJlpt.length === 0 && bad.noSkill.length === 0 && bad.certCols.length === 0, [...bad.noJlpt, ...bad.noSkill].slice(0, 3).join(", "));
  check("Setiap kandidat punya >= 3 penilaian bulanan LPK", bad.fewAssess.length === 0, String(bad.fewAssess.length));
  check("Setiap kandidat punya paspor, ijazah, foto, dan medical check-up", bad.docs.length === 0, String(bad.docs.length));
  const expired = [...privBy.values()].filter((p) => p.passportExpiryDate! < new Date().toISOString().slice(0, 10)).length;
  const soon = [...privBy.values()].filter((p) => p.passportExpiryDate! >= new Date().toISOString().slice(0, 10) && p.passportExpiryDate! < new Date(Date.now() + 183 * 86_400_000).toISOString().slice(0, 10)).length;
  check("Paspor bervariasi: 1-2 sudah lewat, 3-4 kurang dari 6 bulan", expired >= 1 && expired <= 2 && soon >= 3 && soon <= 4, `lewat ${expired}, <6 bulan ${soon}`);

  // Keputusan TSK: semua nilai (selain NONE) muncul >= 2 kali; catatan TSK >= 8 dengan kedua visibilitas; penilaian TSK ada
  const decCount = new Map<string, number>();
  for (const s of data.sels) decCount.set(s.decision, (decCount.get(s.decision) ?? 0) + 1);
  const missing = selectionDecision.enumValues.filter((d) => d !== "NONE" && (decCount.get(d) ?? 0) < 2);
  check("Setiap nilai keputusan TSK muncul minimal 2 kali", missing.length === 0, missing.join(", ") || [...decCount].map(([k, v]) => `${k}:${v}`).join(" "));
  const noteTotal = data.notes.reduce((a, b) => a + b.n, 0);
  check("Catatan TSK >= 8 dengan campuran visibilitas", noteTotal >= 8 && data.notes.length === 2, `${noteTotal}`);
  const kinds = new Set(data.tskAssess.map((a) => a.k));
  check("Ada penilaian TSK_VISIT dan TSK_INTERVIEW", kinds.has("TSK_VISIT") && kinds.has("TSK_INTERVIEW"), data.tskAssess.map((a) => `${a.k}/${a.v}:${a.n}`).join(" "));

  // Daftar "Belum dinilai bulan ini" tidak kosong dan tidak berisi semua
  const period = currentPeriod();
  const pending = await withSystem(async (tx) => (await tx.execute(sql`
    select count(*)::int as n from candidates c where c.stage in ('STUDYING','READY')
      and not exists (select 1 from candidate_assessments a where a.candidate_id = c.id and a.kind = 'LPK_MONTHLY' and a.period = ${period})`)).rows[0] as { n: number }, ownerDb.db);
  const active = data.cands.filter((c) => c.stage !== "WITHDRAWN").length;
  check('Daftar "Belum dinilai bulan ini" berisi sebagian kandidat (bukan kosong, bukan semua)', pending.n > 0 && pending.n < active, `${pending.n} dari ${active}`);

  // ---------- 1b. Klien, job order, dan penempatan ----------
  const cli = await withSystem(async (tx) => ({
    companies: await tx.select().from(clientCompanies),
    sites: await tx.select().from(clientSites),
    contacts: await tx.select().from(clientSiteContacts),
    siteFields: await tx.select().from(clientSiteFields),
    jos: await tx.select().from(jobOrders),
    sels: await tx.select().from(candidateSelections),
    pls: await tx.select().from(placements),
  }), ownerDb.db);
  const distinctFields = new Set(cli.siteFields.map((f) => f.fieldId));
  check("Klien demo: >= 3 perusahaan, >= 5 lokasi di >= 3 bidang kerja berbeda", cli.companies.length >= 3 && cli.sites.length >= 5 && distinctFields.size >= 3, `${cli.companies.length} perusahaan, ${cli.sites.length} lokasi, ${distinctFields.size} bidang`);
  const noContact = cli.sites.filter((x) => !cli.contacts.some((c) => c.siteId === x.id)).map((x) => x.id);
  check("Setiap lokasi klien punya minimal satu PIC", noContact.length === 0, String(noContact.length));
  check("Job order demo: >= 6 dengan status campuran (OPEN, FILLED, CLOSED)", cli.jos.length >= 6 && ["OPEN", "FILLED", "CLOSED"].every((st) => cli.jos.some((j) => j.status === st)), cli.jos.map((j) => j.status).join(","));
  const badField = cli.jos.filter((j) => !cli.siteFields.some((f) => f.siteId === j.siteId && f.fieldId === j.fieldId)).map((j) => j.id);
  check("Bidang tiap job order termasuk bidang yang diterima lokasinya", badField.length === 0, String(badField.length));
  const REQUIRES_JO = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"]; // eksplisit
  const noJo = cli.sels.filter((x) => REQUIRES_JO.includes(x.decision) && !x.jobOrderId).length;
  check("Tidak ada keputusan PASSED_CLIENT_INTERVIEW atau sesudahnya tanpa job order", noJo === 0, String(noJo));
  const departed = cli.sels.filter((x) => x.decision === "DEPARTED");
  const activeBy = new Map<string, number>();
  for (const p of cli.pls.filter((x) => x.status === "ACTIVE")) activeBy.set(p.candidateId, (activeBy.get(p.candidateId) ?? 0) + 1);
  check("Kandidat DEPARTED punya penempatan aktif, dan tidak ada kandidat dengan lebih dari satu penempatan aktif", departed.length > 0 && departed.every((x) => activeBy.get(x.candidateId) === 1) && [...activeBy.values()].every((n) => n === 1), `${departed.length} berangkat, ${activeBy.size} aktif`);
  const tskOrg = data.orgs.find((o) => o.type === "TSK")!;
  const lacking: string[] = [];
  for (const jo of cli.jos.filter((j) => j.status === "OPEN")) {
    const rows = await withTenant({ orgId: tskOrg.id, role: "TSK_ADMIN" as Role }, (tx) => matchCandidates(tx, jo, tskOrg.id), appDb.db);
    if (rows.length === 0) lacking.push(jo.title);
  }
  check("Setiap job order OPEN punya minimal satu kandidat cocok (halaman Kandidat cocok tidak kosong)", lacking.length === 0, lacking.join(", ") || `${cli.jos.filter((j) => j.status === "OPEN").length} job order OPEN`);

  // ---------- 2. Filter di /candidates (fungsi yang sama dengan halaman) ----------
  const lpks = data.orgs.filter((o) => o.type === "LPK");
  const tsk = data.orgs.find((o) => o.type === "TSK")!;
  const contexts: Array<{ name: string; orgId: string; role: Role; isTsk: boolean }> = [
    ...lpks.map((o) => ({ name: `Admin ${o.name}`, orgId: o.id, role: "LPK_ADMIN" as Role, isTsk: false })),
    { name: `Admin ${tsk.name}`, orgId: tsk.id, role: "TSK_ADMIN" as Role, isTsk: true },
  ];
  const report: string[] = [];
  for (const ctx of contexts) {
    const run = (params: Record<string, string>) =>
      withTenant({ orgId: ctx.orgId, role: ctx.role }, async (tx) => (await listCandidatesFiltered(tx, parseFilters(params, ctx.isTsk), ctx.isTsk ? ctx.orgId : null)).list.total, appDb.db);
    const all = await run({});
    const fields = await withTenant({ orgId: ctx.orgId, role: ctx.role }, async (tx) => (await tx.selectDistinct({ f: skillFields.code }).from(candidates).innerJoin(skillFields, eq(skillFields.id, candidates.fieldId))).map((r) => r.f).sort(), appDb.db);
    const cases: Array<[string, Record<string, string>, boolean]> = [
      ["nilai minimal 4", { avg: "4" }, true],
      ["kehadiran minimal 90", { attendance: "90" }, true],
      ["JLPT N4", { jlpt: "N4" }, true],
      ["JLPT N3", { jlpt: "N3" }, true],
      ["JLPT N2", { jlpt: "N2" }, true],
      // N5 = "N5 atau lebih tinggi": semua kandidat punya JLPT, jadi hasilnya memang seluruh kandidat; cukup tidak kosong
      ["JLPT N5 (atau lebih tinggi)", { jlpt: "N5" }, false],
      ...fields.map((f): [string, Record<string, string>, boolean] => [`bidang ${f}`, { field: f }, true]),
      ...(ctx.isTsk ? selectionDecision.enumValues.map((d): [string, Record<string, string>, boolean] => [`keputusan ${d}`, { decision: d }, true]) : []),
    ];
    const problems: string[] = [];
    const counts: string[] = [];
    for (const [label, params, mustBeProper] of cases) {
      const n = await run(params);
      if (label === "JLPT N3" || label === "kehadiran minimal 90" || label === "nilai minimal 4") counts.push(`${label}: ${n}`);
      if (n === 0 || (mustBeProper && n >= all)) problems.push(`${label} -> ${n}/${all}`);
    }
    check(`Filter di /candidates bermakna untuk ${ctx.name} (${cases.length} kasus dari ${all} kandidat)`, all > 0 && problems.length === 0, problems.join("; "));
    report.push(`${ctx.name}: ${all} kandidat; ${counts.join(", ")}`);
  }
  console.log(`  Ringkasan filter -> ${report.join(" | ")}`);

  // ---------- 3. Berkas dokumen vs baris database ----------
  if (process.env.VERIFY_SKIP_FILES === "1") {
    console.log("ℹ VERIFY_SKIP_FILES=1: pemeriksaan berkas dilewati");
  } else {
    const root = storageRootFor();
    const onDisk = await walkFiles(root);
    const candOrg = new Map(data.cands.map((c) => [c.id, c.organizationId]));
    const ext = (mime: string) => (mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg");
    const expected = new Set(data.docs.map((d) => path.join(candOrg.get(d.candidateId)!, d.candidateId, `${d.id}.${ext(d.mimeType)}`)));
    const orphans = [...onDisk].filter((f) => !expected.has(f));
    const lost = [...expected].filter((f) => !onDisk.has(f));
    check(`Tidak ada berkas yatim di ${root} (berkas tanpa baris dokumen)`, orphans.length === 0, `${onDisk.size} berkas; yatim ${orphans.length}${orphans.length ? `: ${orphans.slice(0, 3).join(", ")}` : ""}`);
    check("Setiap baris dokumen punya berkasnya", lost.length === 0, `hilang ${lost.length}${lost.length ? `: ${lost.slice(0, 3).join(", ")}` : ""}`);
  }

  await ownerDb.pool.end();
  await appDb.pool.end();
  console.log(failures === 0 ? "\nSeed demo lengkap dan konsisten." : `\n${failures} pemeriksaan GAGAL.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exit(1);
});
