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
import { AUDIT_PAGE_SIZE, listAudit, parseAuditFilters } from "../src/db/audit-history";
import { ACTIONS } from "../src/db/audit-describe";
import { activeWorkers, allWorkers, followupIds, openInterviewQuarters, quartersOfFiscalYear, unreadRecordIds, unreadReportIds } from "../src/db/records-queries";
import { fiscalYearOf } from "../src/db/records-core";
import { responsibilityOverview } from "../src/db/responsibility-queries";
import { todayInTskTz } from "../src/db/time";
import { demoAttachmentPath } from "../src/db/demo-files";
import { access } from "node:fs/promises";
import { INCOMPLETE_CANDIDATE_COLUMNS, INTENTIONALLY_INCOMPLETE } from "../src/db/demo-data";
import { uuidFor } from "../src/db/demo-rng";
import { FILTER_VIEWS_LPK, FILTER_VIEWS_TSK, viewCandidateIds, type FilterView } from "../src/db/dashboard-queries";
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

  const incompleteIds = new Set(Object.entries(INTENTIONALLY_INCOMPLETE).flatMap(([o, is]) => is.map((i) => uuidFor(`candidate:${o}:${i}`))));
  const bad = {
    cols: emptyColumns(candidates, data.cands as never, OPTIONAL_CANDIDATE_COLUMNS).filter((x) => {
      const [idx, col] = x.slice(1).split(".");
      return !(INCOMPLETE_CANDIDATE_COLUMNS as readonly string[]).includes(col) || !incompleteIds.has(data.cands[Number(idx)].id);
    }),
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

  // ---------- 2b. Filter kartu KPI dashboard (?view=...): tidak kosong dan bukan semua kandidat ----------
  const viewProblems: string[] = [];
  const viewReport: string[] = [];
  for (const ctx of contexts) {
    const views: readonly FilterView[] = ctx.isTsk ? FILTER_VIEWS_TSK : FILTER_VIEWS_LPK;
    const all = await withTenant({ orgId: ctx.orgId, role: ctx.role }, async (tx) => (await tx.select({ id: candidates.id }).from(candidates)).length, appDb.db);
    for (const v of views) {
      const n = await withTenant({ orgId: ctx.orgId, role: ctx.role }, async (tx) => (await viewCandidateIds(tx, v)).length, appDb.db);
      viewReport.push(`${ctx.name}/${v}=${n}`);
      // Hanya Bandung (LPK mitra utama) dan TSK demo dituntut bermakna; Medan non-mitra cukup tidak error
      if (ctx.name.includes("Medan")) continue;
      if (n === 0 || n >= all) viewProblems.push(`${ctx.name}/${v} -> ${n}/${all}`);
    }
  }
  check("Filter kartu KPI (view) bermakna: tidak kosong dan bukan semua kandidat", viewProblems.length === 0, viewProblems.join("; "));
  console.log(`  Ringkasan view -> ${viewReport.join(", ")}`);

  // ---------- 2c. Riwayat aktivitas: tiap admin melihat >= 25 entri (halaman + filter jenis), entri dikenal, tanpa nama kandidat, lintas organisasi tanpa nama orang ----------
  const auditProblems: string[] = [];
  const auditReport: string[] = [];
  for (const ctx of contexts) {
    if (ctx.name.includes("Medan")) continue; // non-mitra: hanya log sendiri, cukup tidak error
    const res = await withTenant({ orgId: ctx.orgId, role: ctx.role }, (tx) => listAudit(tx, parseAuditFilters({}), "Asia/Jakarta"), appDb.db);
    const cat = await withTenant({ orgId: ctx.orgId, role: ctx.role }, (tx) => listAudit(tx, parseAuditFilters({ category: "candidate" }), "Asia/Jakarta"), appDb.db);
    auditReport.push(`${ctx.name}=${res.total}`);
    if (res.total < 25) auditProblems.push(`${ctx.name}: hanya ${res.total} entri`);
    if (res.rows.length === 0 || res.rows.length > AUDIT_PAGE_SIZE) auditProblems.push(`${ctx.name}: halaman pertama ${res.rows.length}`);
    if (ctx.role === "LPK_ADMIN" && (cat.total === 0 || cat.total >= res.total)) auditProblems.push(`${ctx.name}: filter jenis tidak bermakna (${cat.total}/${res.total})`);
  }
  const allAudit = await withSystem((tx) => tx.execute(sql`select action, actor_org_id::text, organization_id::text, actor_name, actor_role, before::text as b, after::text as a, entity_id from audit_logs`), ownerDb.db);
  const aRows = allAudit.rows as Array<{ action: string; actor_org_id: string; organization_id: string; actor_name: string | null; actor_role: string | null; b: string | null; a: string | null; entity_id: string | null }>;
  const unknownActions = [...new Set(aRows.map((r) => r.action).filter((a) => !(a in ACTIONS)))];
  const leakedNames = data.cands.filter((c) => aRows.some((r) => `${r.b ?? ""}${r.a ?? ""}`.includes(c.fullName))).length;
  const crossNamed = aRows.filter((r) => r.actor_org_id !== r.organization_id && r.actor_name !== null).length;
  const noSnapshot = aRows.filter((r) => !r.actor_role).length;
  check("Riwayat aktivitas: tiap admin LPK/TSK demo melihat >= 25 entri, halaman dan filter jenis bermakna", auditProblems.length === 0, auditProblems.join("; ") || auditReport.join(", "));
  check("Riwayat aktivitas: semua aksi dikenal describeAudit; tanpa nama kandidat; entri lintas organisasi tanpa nama orang; semua punya potret pelaku", unknownActions.length === 0 && leakedNames === 0 && crossNamed === 0 && noSnapshot === 0, `tak dikenal ${unknownActions.join(",") || 0}, nama bocor ${leakedNames}, lintas bernama ${crossNamed}, tanpa potret ${noSnapshot}`);

  // ---------- 2d. Catatan kegiatan TSK (langkah 7A) ----------
  {
    const ownerQ = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await withSystem((tx) => tx.execute(q), ownerDb.db)).rows as T[];
    const n = async (q: ReturnType<typeof sql>) => Number((await ownerQ<{ n: string }>(q))[0].n);
    const today = todayInTskTz();
    const tskUsers = await ownerQ<{ id: string; role: string; email: string }>(sql`select id::text, role::text, email from users where organization_id = ${tsk.id}::uuid and role in ('TSK_ADMIN', 'TSK_STAFF') order by email`);
    const admin = tskUsers.find((u) => u.role === "TSK_ADMIN")!;
    const asTsk = <T,>(u: { id: string; role: string }, fn: (tx: import("../src/db").Tx) => Promise<T>) => withTenant({ orgId: tsk.id, role: u.role as Role, userId: u.id }, fn, appDb.db);
    const recs = await ownerQ<{ kind: string; status: string; version_no: number; author_id: string; action_taken: string | null; subject: string | null }>(sql`select kind, status, version_no, author_id::text, action_taken, subject from activity_records`);
    const daily = recs.filter((r) => r.kind === "daily_work");
    const meetings = recs.filter((r) => r.kind === "meeting");
    check("Catatan kegiatan: >= 12 catatan ① (tersebar >= 4 hari, >= 3 penulis, 1 dibatalkan, 1 punya >= 2 versi) dan >= 4 notulen ②", daily.length >= 12 && new Set(daily.map((r) => r.author_id)).size >= 3 && (await n(sql`select count(distinct record_date)::int as n from activity_records where kind = 'daily_work'`)) >= 4 && daily.some((r) => r.status === "void") && recs.some((r) => r.version_no >= 2 && r.status === "active") && meetings.length >= 4, `${daily.length} harian, ${meetings.length} notulen`);
    check("Catatan kegiatan: isi berbahasa Jepang (≥ 90% catatan ① berisi huruf Jepang)", daily.filter((r) => /[\u3040-\u30ff\u3400-\u9fff]/.test(r.action_taken ?? "")).length >= Math.ceil(daily.length * 0.9));
    // Rangkaian lanjutan (T-007): >= 1 catatan lanjutan, semuanya valid (asal aktif, organisasi sama, minimal satu pekerja yang sama)
    const contAll = await n(sql`select count(*)::int as n from activity_records where continues_record_id is not null`);
    const contOk = await n(sql`select count(*)::int as n from activity_records r join activity_records p on p.id = r.continues_record_id where p.organization_id = r.organization_id and p.status = 'active' and exists (select 1 from activity_record_subjects c join activity_record_subjects q on q.candidate_id = c.candidate_id and q.record_id = p.id where c.record_id = r.id)`);
    check("Catatan lanjutan: >= 1 rangkaian lanjutan dan semuanya valid (asal aktif, satu organisasi, pekerja sama)", contAll >= 1 && contAll === contOk, `${contOk} dari ${contAll} valid`);
    const cases = await ownerQ<{ id: string; status: string; code: string }>(sql`select id::text, status, code from activity_cases order by code`);
    const maxEv = Math.max(0, ...(await ownerQ<{ n: number }>(sql`select count(*)::int as n from case_timeline_events group by case_id`)).map((r) => r.n));
    check("Kasus: >= 2 (satu terbuka dengan >= 6 baris kronologi, satu selesai), kode berurutan K-tahun-nomor, kronologi punya baris dari catatan dan baris batal", cases.length >= 2 && cases.some((c) => c.status === "open") && cases.some((c) => c.status === "closed") && maxEv >= 6 && cases.every((c) => /^K-\d{4}-\d{4}$/.test(c.code)) && (await n(sql`select count(*)::int as n from case_timeline_events where source_record_id is not null`)) >= 2 && (await n(sql`select count(*)::int as n from case_timeline_events where status = 'void'`)) >= 1, `${cases.length} kasus, baris terbanyak ${maxEv}`);
    const overdue = await n(sql`select count(*)::int as n from activity_followups where status = 'open' and due_date < ${today}::date`);
    check("Tugas tindak lanjut: >= 6, ada yang lewat tenggat, selesai, dan dibatalkan", (await n(sql`select count(*)::int as n from activity_followups`)) >= 6 && overdue >= 1 && (await n(sql`select count(*)::int as n from activity_followups where status = 'done'`)) >= 1 && (await n(sql`select count(*)::int as n from activity_followups where status = 'cancelled'`)) >= 1, `lewat tenggat ${overdue}`);
    const reports = await ownerQ<{ author_id: string; shared_at: string | null }>(sql`select author_id::text, shared_at::text from activity_daily_reports where shared_at is not null`);
    const addedAfter = await n(sql`select count(*)::int as n from activity_records r join activity_daily_reports d on d.author_id = r.author_id and d.report_date = r.record_date where r.kind = 'daily_work' and d.shared_at is not null and r.created_at > d.shared_at`);
    check("Laporan harian: 3 staf mengirim laporan; satu punya ① ditambahkan setelah dikirim; pembaca campuran (ada yang sudah, ada yang belum)", new Set(reports.map((r) => r.author_id)).size >= 3 && addedAfter >= 1 && (await n(sql`select count(*)::int as n from activity_daily_report_recipients where read_at is not null`)) >= 1 && (await n(sql`select count(*)::int as n from activity_daily_report_recipients where read_at is null`)) >= 1, `${reports.length} laporan`);
    const unreadAdmin = await asTsk(admin, (tx) => unreadRecordIds(tx, admin.id));
    const staleAdmin = await n(sql`select count(*)::int as n from activity_record_reads rr join activity_records r on r.id = rr.record_id where rr.user_id = ${admin.id}::uuid and rr.version_no_read < r.version_no and r.status = 'active'`);
    const readsTotal = await n(sql`select count(*)::int as n from activity_record_reads`);
    check("Tanda baca campuran: ada catatan belum dibaca, ada yang sudah, ada yang 'diperbarui sejak kamu baca'; KPI belum dibaca > 0", unreadAdmin.length > 0 && readsTotal >= 5 && staleAdmin >= 1, `admin belum baca ${unreadAdmin.length}, usang ${staleAdmin}`);
    const att = await ownerQ<{ id: string; mime: string }>(sql`select id::text, mime from activity_attachments where removed_at is null`);
    check("Lampiran: >= 2 gambar dummy, satu ikut PDF", att.length >= 2 && (await n(sql`select count(*)::int as n from activity_attachments where include_in_pdf`)) >= 1, `${att.length} lampiran`);
    if (process.env.VERIFY_SKIP_FILES !== "1") {
      const root = storageRootFor();
      const lost: string[] = [];
      for (const a of att) {
        try { await access(demoAttachmentPath(root, tsk.id, a.id, a.mime === "image/png" ? "png" : a.mime === "image/webp" ? "webp" : "jpg")); } catch { lost.push(a.id); }
      }
      check("Setiap lampiran punya berkasnya di penyimpanan", lost.length === 0, `hilang ${lost.length}`);
    }
    const workers = await asTsk(admin, (tx) => activeWorkers(tx));
    check("Pekerja aktif: >= 3 dari >= 2 lokasi klien", workers.length >= 3 && new Set(workers.map((w) => w.siteId)).size >= 2, `${workers.length} pekerja, ${new Set(workers.map((w) => w.siteId)).size} lokasi`);
    const piRows = await ownerQ<{ candidate_id: string; result_status: string | null; applicable: boolean; reason: string | null }>(sql`select candidate_id::text, result_status, applicable, reason from periodic_interviews where status = 'active'`);
    const piBy = new Set(piRows.map((r) => r.candidate_id));
    const pending = await asTsk(admin, (tx) => openInterviewQuarters(tx, today));
    const statusSet = new Set(piRows.map((r) => r.result_status));
    check("Wawancara berkala: tiap pekerja aktif punya wawancara; campuran status (問題なし dominan, 要フォロー, 問題あり, 未実施), semua alasan, bulan 対象外, kuartal Q1; ada kuartal berjalan (open)", workers.every((w) => piBy.has(w.id)) && ["no_issue", "follow_up", "issue", "not_done"].every((s) => statusSet.has(s)) && piRows.filter((r) => r.result_status === "no_issue").length > piRows.length / 2 - 1 && ["agency", "support", "worker"].every((x) => piRows.some((r) => r.reason === x)) && piRows.some((r) => !r.applicable) && (await n(sql`select count(*)::int as n from periodic_interview_quarter_notes where quarter = 1`)) >= 1 && pending.length > 0, `${piRows.length} wawancara; kuartal open ${pending.length}`);
    // Aturan kuartal + pekerja berhenti (T-008): KPI = jumlah kuartal Belum pada fungsi yang sama dengan grid; pekerja ENDED di tengah FY ikut grid/laporan FY-nya, tidak FY sesudahnya
    const curQ = await asTsk(admin, (tx) => quartersOfFiscalYear(tx, fiscalYearOf(today), today));
    const gridPending = curQ.reduce((nn, x) => nn + x.quarters.filter((c) => c.state === "open").length, 0);
    check("KPI 定期面談 = jumlah kuartal BERJALAN (open) di grid (satu fungsi: quartersOfFiscalYear); kuartal terlewat (missed) tidak masuk KPI", gridPending === pending.length && pending.length > 0, `KPI ${pending.length}, grid ${gridPending}`);
    const missedAll = curQ.reduce((nn, x) => nn + x.quarters.filter((c) => c.state === "missed").length, 0);
    check("Wawancara berkala: seed memuat >= 1 kuartal open (berjalan) dan >= 1 kuartal missed (terlewat)", pending.length >= 1 && missedAll >= 1, `open ${pending.length}, missed ${missedAll}`);
    // Penanggung jawab pekerja (T-010): KPI/daftar = satu fungsi; ada pekerja tanpa penanggung jawab, ada penetapan per perusahaan dan per pekerja; ENDED tidak dihitung dalam beban
    const ov = await asTsk(admin, (tx) => responsibilityOverview(tx, today));
    const ov2 = await asTsk(admin, (tx) => responsibilityOverview(tx, today));
    const activeN = ov.workers.filter((w) => w.status === "ACTIVE").length;
    const loadSum = ov.workload.reduce((nn, x) => nn + x.count, 0);
    const asg = await ownerQ<{ company: string; placement: string }>(sql`select count(*) filter (where company_id is not null)::text as company, count(*) filter (where placement_id is not null)::text as placement from responsible_assignments`);
    check("Penanggung jawab: >= 1 pekerja aktif tanpa penanggung jawab; ada penetapan per perusahaan dan per pekerja; beban per staf hanya menghitung pekerja ACTIVE (jumlah beban + tanpa penanggung jawab = pekerja aktif); KPI = daftar (fungsi sama)", ov.unassigned.length >= 1 && Number(asg[0].company) >= 1 && Number(asg[0].placement) >= 1 && loadSum + ov.unassigned.length === activeN && ov.overLimit.length === ov2.overLimit.length && ov.unassigned.length === ov2.unassigned.length, `aktif ${activeN}, beban ${loadSum}, tanpa ${ov.unassigned.length}, melebihi ${ov.overLimit.length}, penetapan perusahaan ${asg[0].company} / pekerja ${asg[0].placement}`);
    const endedW = (await asTsk(admin, (tx) => allWorkers(tx))).filter((w) => w.status === "ENDED");
    const endedFy = endedW[0]?.endDate ? fiscalYearOf(endedW[0].endDate) : null;
    const qEnded = endedFy !== null ? await asTsk(admin, (tx) => quartersOfFiscalYear(tx, endedFy, today)) : [];
    const qAfter = endedFy !== null ? await asTsk(admin, (tx) => quartersOfFiscalYear(tx, endedFy + 1, today)) : [];
    check("Pekerja berhenti: >= 1 penempatan ENDED; muncul di grid/laporan FY-nya dengan >= 1 kuartal terlewat (missed); TIDAK muncul di FY sesudah berhenti; bukan pekerja aktif", endedW.length >= 1 && qEnded.some((x) => x.worker.id === endedW[0].id && x.quarters.some((c) => c.state === "missed")) && !qAfter.some((x) => x.worker.id === endedW[0].id) && !workers.some((w) => w.id === endedW[0].id), `${endedW.length} berhenti; FY ${endedFy}`);
    // KPI dashboard = fungsi yang sama dengan daftar: panggilan kedua menghasilkan himpunan identik (tidak bergantung urutan)
    const kpi = await asTsk(admin, async (tx) => ({ r: (await unreadRecordIds(tx, admin.id)).length, l: (await unreadReportIds(tx, admin.id)).length, f: (await followupIds(tx, {})).length }));
    check("KPI Catatan kegiatan bermakna: belum dibaca > 0, laporan belum dibaca >= 1, tindak lanjut terbuka > 0", kpi.r > 0 && kpi.l >= 1 && kpi.f > 0, JSON.stringify(kpi));
  }

  // ---------- 2e. Informasi untuk lembar klien (langkah 6) ----------
  {
    const ownerQ = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await withSystem((tx) => tx.execute(q), ownerDb.db)).rows as T[];
    const n = async (q: ReturnType<typeof sql>) => Number((await ownerQ<{ n: string }>(q))[0].n);
    const cjk = /[\u3040-\u30ff\u3400-\u9fff]/;
    const comps = await ownerQ<{ industry: string | null; employee_count: number | null; foreign_worker_experience: string | null; public_intro: string | null }>(sql`select industry, employee_count, foreign_worker_experience, public_intro from client_companies`);
    const completeCo = comps.filter((c) => c.industry && c.employee_count !== null && c.foreign_worker_experience && c.public_intro);
    const emptyCo = comps.filter((c) => !c.industry && c.employee_count === null && !c.foreign_worker_experience && !c.public_intro);
    check("Lembar klien: >= 2 perusahaan lengkap (berisi huruf Jepang) dan TEPAT 1 perusahaan sengaja kosong", completeCo.length >= 2 && emptyCo.length === 1 && completeCo.every((c) => cjk.test(c.public_intro ?? "") && cjk.test(c.industry ?? "")), `${completeCo.length} lengkap, ${emptyCo.length} kosong`);
    check("Lembar klien: >= 4 lokasi punya akses/stasiun dan >= 1 lokasi kosong", (await n(sql`select count(*)::int as n from client_sites where access_note is not null`)) >= 4 && (await n(sql`select count(*)::int as n from client_sites where access_note is null`)) >= 1);
    const jos = await ownerQ<{ status: string; work_hours: string | null; days_off: string | null; housing: string | null; commute_note: string | null; benefits_note: string | null }>(sql`select status::text, work_hours, days_off, housing, commute_note, benefits_note from job_orders`);
    const joDone = jos.filter((j) => j.work_hours && j.days_off && j.housing && j.commute_note && j.benefits_note);
    const joEmpty = jos.filter((j) => !j.work_hours && !j.days_off && !j.housing && !j.commute_note && !j.benefits_note);
    check("Lembar klien: >= 5 job order lengkap dan TEPAT 1 job order OPEN sengaja kosong", joDone.length >= 5 && joEmpty.length === 1 && joEmpty[0].status === "OPEN", `${joDone.length} lengkap, ${joEmpty.length} kosong`);
    check("Lembar klien: jenis tempat tinggal beragam (>= 2 nilai) dan jam kerja berbahasa Jepang", new Set(joDone.map((j) => j.housing)).size >= 2 && joDone.every((j) => cjk.test(j.work_hours ?? "")));
  }

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
