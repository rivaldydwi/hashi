// Memeriksa data PILOT (T-014; hanya MEMBACA): jumlah, kelengkapan, berkas, sebaran keputusan/tahap kartu, beban staf, dan bahwa angka KPI = daftar tetap berlaku pada volume ini.
// Dijalankan SETELAH `npm run seed:pilot`. Tidak bergantung pada isi seed dasar selain organisasi/pengguna demo. Pemakaian: npm run verify:pilot
import "dotenv/config";
import { access } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createDb, withSystem, withTenant, type Tx } from "../src/db";
import { listCandidatesFiltered, parseFilters } from "../src/db/candidate-list";
import { FILTER_VIEWS_LPK, FILTER_VIEWS_TSK, viewCandidateIds } from "../src/db/dashboard-queries";
import { PILOT_CANDIDATES, PILOT_HEAVY_STAFF_EMAIL, PILOT_ORG_COUNTS, PILOT_ORG_NAMES } from "../src/db/demo-pilot";
import { demoDocumentPath, storageRootFor } from "../src/db/demo-files";
import { uuidFor } from "../src/db/demo-rng";
import { responsibilityOverview } from "../src/db/responsibility-queries";
import { todayInTskTz } from "../src/db/time";
import { cardKpiCounts, filterCardRows, loadCardRows } from "../src/db/zairyu-queries";
import { workloadLevel } from "../src/db/responsibility";
import type { Role } from "../src/db/schema";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const T = (key: string) => uuidFor(`pilot:${key}`);

async function main() {
  const owner = process.env.MIGRATE_DATABASE_URL;
  const app = process.env.DATABASE_URL;
  if (!owner || !app) throw new Error("MIGRATE_DATABASE_URL dan DATABASE_URL harus di-set");
  const ownerDb = createDb(owner, 2);
  const appDb = createDb(app, 2);
  const today = todayInTskTz();
  const ownerQ = <R extends Record<string, unknown>>(q: ReturnType<typeof sql>) => withSystem(async (tx) => (await tx.execute(q)).rows as R[], ownerDb.db);

  const ids: string[] = [];
  const idsByOrg: string[][] = PILOT_ORG_COUNTS.map((n, o) => Array.from({ length: n }, (_, k) => T(`candidate:${o}:${k}`)));
  for (const l of idsByOrg) ids.push(...l);
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

  // ---- 1. Jumlah dan kelengkapan
  const perOrg = await ownerQ<{ name: string; n: number }>(sql`select o.name, count(*)::int as n from candidates c join organizations o on o.id = c.organization_id where c.id in (${idList}) group by o.name`);
  const got = Object.fromEntries(perOrg.map((r) => [r.name, r.n]));
  check(`Kandidat pilot tepat ${PILOT_CANDIDATES} (Bandung ${PILOT_ORG_COUNTS[0]}, Surabaya ${PILOT_ORG_COUNTS[1]}, Medan ${PILOT_ORG_COUNTS[2]}); tidak ganda setelah dijalankan ulang`, PILOT_ORG_NAMES.every((n, i) => got[n] === PILOT_ORG_COUNTS[i]), JSON.stringify(got));

  const parts = await ownerQ<Record<string, number>>(sql`
    select
      (select count(*) from candidate_private where candidate_id in (${idList}))::int as priv,
      (select count(distinct candidate_id) from candidate_family_members where candidate_id in (${idList}))::int as fam,
      (select count(distinct candidate_id) from candidate_educations where candidate_id in (${idList}))::int as edu,
      (select count(distinct candidate_id) from candidate_work_histories where candidate_id in (${idList}))::int as work,
      (select count(distinct candidate_id) from candidate_certificates where candidate_id in (${idList}))::int as cert,
      (select count(*) from candidate_documents where candidate_id in (${idList}))::int as docs,
      (select count(*) from (select candidate_id from candidate_assessments where candidate_id in (${idList}) and kind = 'LPK_MONTHLY' group by candidate_id having count(*) >= 3) x)::int as assess3`);
  const p = parts[0];
  check("Kelengkapan: tiap kandidat pilot punya data pribadi, keluarga, pendidikan, riwayat kerja, sertifikat, 3 dokumen, dan >= 3 penilaian bulanan",
    p.priv === PILOT_CANDIDATES && p.fam === PILOT_CANDIDATES && p.edu === PILOT_CANDIDATES && p.work === PILOT_CANDIDATES && p.cert === PILOT_CANDIDATES && p.docs === PILOT_CANDIDATES * 3 && p.assess3 === PILOT_CANDIDATES, JSON.stringify(p));
  const stages = await ownerQ<{ stage: string; n: number }>(sql`select stage::text, count(*)::int as n from candidates where id in (${idList}) group by stage`);
  check("Sebaran status LPK: Belajar, Siap seleksi, dan Mundur masing-masing >= 10", ["STUDYING", "READY", "WITHDRAWN"].every((s) => (stages.find((x) => x.stage === s)?.n ?? 0) >= 10), JSON.stringify(stages));

  // ---- 2. Berkas dokumen dummy ada di disk
  const docs = await ownerQ<{ org: string; cid: string; id: string; mime: string }>(sql`select c.organization_id::text as org, d.candidate_id::text as cid, d.id::text as id, d.mime_type as mime from candidate_documents d join candidates c on c.id = d.candidate_id where d.candidate_id in (${idList})`);
  const root = storageRootFor();
  let missing = 0;
  for (const d of docs) {
    try {
      await access(demoDocumentPath(root, d.org, d.cid, d.id, d.mime === "image/png" ? "png" : "pdf"));
    } catch {
      missing++;
    }
  }
  check(`Berkas dokumen pilot: ${docs.length} baris, tidak ada yang hilang di storage`, docs.length === PILOT_CANDIDATES * 3 && missing === 0, `hilang ${missing}`);

  // ---- 3. Keputusan TSK, pekerja aktif, catatan, wawancara
  const decisions = await ownerQ<{ decision: string; n: number }>(sql`select decision::text, count(*)::int as n from candidate_selections where candidate_id in (${idList}) group by decision`);
  const dec = Object.fromEntries(decisions.map((d) => [d.decision, d.n]));
  check("Keputusan TSK pilot: semua nilai (SHORTLISTED, PASSED_TSK_INTERVIEW, SUBMITTED_TO_CLIENT, PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED, REJECTED) >= 2 dan DEPARTED >= 70",
    ["SHORTLISTED", "PASSED_TSK_INTERVIEW", "SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED", "REJECTED"].every((d) => (dec[d] ?? 0) >= 2) && (dec.DEPARTED ?? 0) >= 70, JSON.stringify(dec));
  const act = await ownerQ<Record<string, number>>(sql`
    select
      (select count(*) from placements where candidate_id in (${idList}) and status = 'ACTIVE')::int as workers,
      (select count(distinct s.candidate_id) from activity_record_subjects s where s.candidate_id in (${idList}))::int as withRecords,
      (select count(distinct candidate_id) from periodic_interviews where candidate_id in (${idList}))::int as withInterviews`);
  const workers = act[0].workers;
  check("Pekerja aktif pilot >= 70, semuanya punya catatan harian dan wawancara berkala", workers >= 70 && act[0].withrecords === workers && act[0].withinterviews >= workers - 2, JSON.stringify(act[0]));

  // ---- 4. Sisi TSK: beban staf, kartu 在留カード, KPI = daftar
  const [tsk] = await ownerQ<{ id: string }>(sql`select id::text from organizations where name = 'TSK Demo Tokyo'`);
  const tskUsers = await ownerQ<{ id: string; role: string; email: string }>(sql`select id::text, role::text, email from users where organization_id = ${tsk.id}::uuid and role in ('TSK_ADMIN', 'TSK_STAFF') order by email`);
  const admin = tskUsers.find((u) => u.role === "TSK_ADMIN")!;
  const asTsk = <R,>(u: { id: string; role: string }, fn: (tx: Tx) => Promise<R>) => withTenant({ orgId: tsk.id, role: u.role as Role, userId: u.id }, fn, appDb.db);
  const ov = await asTsk(admin, (tx) => responsibilityOverview(tx, today));
  const heavy = tskUsers.find((u) => u.email === PILOT_HEAVY_STAFF_EMAIL)!;
  const heavyN = ov.workload.find((x) => x.staff.id === heavy.id)?.count ?? 0;
  check("Beban kerja: satu staf TSK memegang >= 45 pekerja aktif dan <= 50 (peringatan KUNING, bukan merah); tidak ada staf melewati 50", heavyN >= 45 && heavyN <= 50 && workloadLevel(heavyN) !== "ok" && ov.workload.every((x) => x.count <= 50), `${PILOT_HEAVY_STAFF_EMAIL}=${heavyN} level=${workloadLevel(heavyN)}`);

  const cardRows = await asTsk(admin, (tx) => loadCardRows(tx, today));
  const stagesSeen = new Set(cardRows.map((r) => r.stage ?? "nodata"));
  const need = ["prepare", "can_apply", "h30", "h14", "h7", "expired", "waiting_result", "special_overdue", "rejected", "none", "nodata"];
  check("Kartu izin tinggal: SEMUA tahap muncul (persiapan, boleh mengajukan, H-30/14/7, lewat, menunggu hasil, 特例期間, lewat 特例期間, ditolak, tanpa tindakan, tanpa data), plus tanda 追加資料",
    need.every((s) => stagesSeen.has(s as never)) && cardRows.some((r) => r.additionalDocs) && cardRows.some((r) => r.stage === "waiting_result" && r.specialUntil), `ada: ${[...stagesSeen].join(",")}; hilang: ${need.filter((s) => !stagesSeen.has(s as never)).join(",") || "-"}`);
  const views = ["urgent", "prepare", "waiting", "missing"] as const;
  const adminKpi = cardKpiCounts(cardRows, { role: "TSK_ADMIN", userId: admin.id });
  const staffOk = tskUsers.filter((u) => u.role === "TSK_STAFF").every((u) => {
    const k = cardKpiCounts(cardRows, { role: "TSK_STAFF", userId: u.id });
    return views.every((v) => k.counts[v] === filterCardRows(cardRows, { view: v, mineUserId: u.id }).length);
  });
  check("Kartu izin tinggal: KPI = jumlah baris daftar (Admin dan tiap staf 'milikku') pada volume pilot; baris kartu = pekerja aktif seluruh organisasi",
    views.every((v) => adminKpi.counts[v] === filterCardRows(cardRows, { view: v }).length) && staffOk && cardRows.length === ov.workers.filter((w) => w.status === "ACTIVE").length, JSON.stringify(adminKpi.counts));

  // ---- 5. KPI dashboard kandidat = daftar (fungsi yang sama dengan halaman), tiap peran admin, pada volume pilot
  const orgs = await ownerQ<{ id: string; name: string }>(sql`select id::text, name from organizations where type in ('LPK', 'TSK') order by name`);
  const problems: string[] = [];
  let checked = 0;
  for (const o of orgs) {
    const isTsk = o.id === tsk.id;
    const role: Role = isTsk ? "TSK_ADMIN" : "LPK_ADMIN";
    const userId = isTsk ? admin.id : undefined;
    for (const v of isTsk ? FILTER_VIEWS_TSK : FILTER_VIEWS_LPK) {
      const kpi = await withTenant({ orgId: o.id, role, userId: userId ?? null }, async (tx) => (await viewCandidateIds(tx, v)).length, appDb.db);
      const list = await withTenant({ orgId: o.id, role, userId: userId ?? null }, async (tx) => (await listCandidatesFiltered(tx, parseFilters({ view: v }, isTsk), isTsk ? o.id : null)).list.total, appDb.db);
      checked++;
      if (kpi !== list) problems.push(`${o.name}/${v}: KPI ${kpi} != daftar ${list}`);
    }
  }
  check(`Kartu KPI dashboard = jumlah baris daftar untuk semua filter (${checked} kombinasi organisasi x filter) pada volume pilot`, problems.length === 0, problems.join("; "));

  await ownerDb.pool.end();
  await appDb.pool.end();
  console.log(failures === 0 ? "\nData pilot lengkap dan konsisten." : `\n${failures} pemeriksaan data pilot GAGAL.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify:pilot error:", err);
  process.exit(1);
});
