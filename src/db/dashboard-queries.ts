// Query dashboard dan filter kartu KPI. SATU sumber kebenaran: angka di kartu = jumlah id dari `viewCandidateIds`, dan daftar /candidates?view=...
// memakai fungsi yang sama (candidate-list.ts memanggil viewCandidateIds). Semua berjalan di dalam withTenant/withSystem, jadi RLS tetap berlaku.
// Pola aman: GROUP BY terpisah (bukan subquery berkorelasi), daftar keputusan eksplisit (bukan `>=` pada enum).
import { and, asc, desc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { assessmentStats, jlptBest, pendingCandidates } from "./candidate-list";
import { candidateHeadlineDecision, candidatePrivate, candidates, organizations, placements, skillFields, type SelectionDecision } from "./schema";
import { candidateCompleteness } from "./completeness";
import { addMonths } from "./demo-rng";
import { currentPeriod, periodMonthsAgo, todayInAppTz } from "./time";

// ------------------------------------------------------------------------------------------------ Filter kartu KPI

export const FILTER_VIEWS_LPK = ["unshared", "passport", "incomplete", "unrated"] as const;
export const FILTER_VIEWS_TSK = ["incomplete", "new-shared", "awaiting", "placed"] as const;
export type FilterView = (typeof FILTER_VIEWS_LPK)[number] | (typeof FILTER_VIEWS_TSK)[number];
export const isFilterView = (v: string, isTsk: boolean): v is FilterView => (isTsk ? FILTER_VIEWS_TSK : FILTER_VIEWS_LPK).includes(v as never);

/** Ambang "paspor habis kurang dari 6 bulan": tanggal hari ini (zona aplikasi) + 6 bulan. */
export const passportHorizon = () => addMonths(todayInAppTz(), 6);

/** Kelengkapan profil semua kandidat yang terlihat. Data sensitif hanya dibaca bila peran boleh (RLS menolak sensei: priv = null). */
export async function completenessMap(tx: Tx, includeSensitive = true) {
  const cands = await tx.select().from(candidates);
  const privs = includeSensitive ? await tx.select().from(candidatePrivate) : [];
  const privBy = new Map(privs.map((p) => [p.candidateId, p as Record<string, unknown>]));
  const counts = new Map<string, { family: number; education: number; work: number; certificates: number }>();
  if (includeSensitive) {
    const res = await tx.execute(sql`
      select candidate_id::text as id, 'family' as k, count(*)::int as n from candidate_family_members group by candidate_id
      union all select candidate_id::text, 'education', count(*)::int from candidate_educations group by candidate_id
      union all select candidate_id::text, 'work', count(*)::int from candidate_work_histories group by candidate_id
      union all select candidate_id::text, 'certificates', count(*)::int from candidate_certificates group by candidate_id`);
    for (const r of res.rows as Array<{ id: string; k: "family" | "education" | "work" | "certificates"; n: number }>) {
      const c = counts.get(r.id) ?? { family: 0, education: 0, work: 0, certificates: 0 };
      c[r.k] = r.n;
      counts.set(r.id, c);
    }
  }
  return new Map(
    cands.map((c) => [
      c.id,
      candidateCompleteness({ candidate: c as Record<string, unknown>, priv: privBy.get(c.id) ?? null, counts: counts.get(c.id) ?? { family: 0, education: 0, work: 0, certificates: 0 }, includeSensitive }),
    ]),
  );
}

/** Id kandidat (yang terlihat oleh pemanggil) untuk satu filter kartu KPI. */
export async function viewCandidateIds(tx: Tx, view: FilterView): Promise<string[]> {
  switch (view) {
    case "unshared": // Siap seleksi tetapi belum dibagikan ke TSK
      return (await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.stage, "READY"), eq(candidates.sharedWithTsk, false)))).map((r) => r.id);
    case "passport": // paspor habis < 6 bulan (termasuk yang sudah lewat)
      return (await tx.select({ id: candidatePrivate.candidateId }).from(candidatePrivate).where(and(isNotNull(candidatePrivate.passportExpiryDate), lt(candidatePrivate.passportExpiryDate, passportHorizon())))).map((r) => r.id);
    case "incomplete":
      return [...(await completenessMap(tx)).entries()].filter(([, c]) => !c.complete).map(([id]) => id);
    case "unrated":
      return (await pendingCandidates(tx, currentPeriod())).map((r) => r.id);
    case "new-shared": { // dibagikan ke TSK dalam 7 hari terakhir
      const since = new Date(Date.now() - 7 * 86_400_000);
      return (await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.sharedWithTsk, true), isNotNull(candidates.sharedWithTskAt), gte(candidates.sharedWithTskAt, since)))).map((r) => r.id);
    }
    case "awaiting": { // terlihat, bukan Mundur, belum punya keputusan selain NONE
      const decided = new Set((await tx.select({ id: candidateHeadlineDecision.candidateId }).from(candidateHeadlineDecision).where(ne(candidateHeadlineDecision.decision, "NONE"))).map((r) => r.id));
      return (await tx.select({ id: candidates.id }).from(candidates).where(ne(candidates.stage, "WITHDRAWN"))).map((r) => r.id).filter((id) => !decided.has(id));
    }
    case "placed":
      return (await tx.select({ id: placements.candidateId }).from(placements).where(eq(placements.status, "ACTIVE"))).map((r) => r.id);
  }
}

// ------------------------------------------------------------------------------------------------ LPK

export async function lpkKpis(tx: Tx) {
  const [unrated, unshared, passportSoon, incomplete] = await Promise.all([
    viewCandidateIds(tx, "unrated"),
    viewCandidateIds(tx, "unshared"),
    viewCandidateIds(tx, "passport"),
    viewCandidateIds(tx, "incomplete"),
  ]);
  const expired = (await tx.select({ id: candidatePrivate.candidateId }).from(candidatePrivate).where(and(isNotNull(candidatePrivate.passportExpiryDate), lt(candidatePrivate.passportExpiryDate, todayInAppTz())))).length;
  return { unrated: unrated.length, unshared: unshared.length, passportSoon: passportSoon.length, passportExpired: expired, incomplete: incomplete.length };
}

export async function candidateTotal(tx: Tx): Promise<number> {
  return (await tx.select({ id: candidates.id }).from(candidates)).length;
}

/** "Perlu dinilai bulan ini": n teratas (urut nama) beserta rata-rata nilai terakhir. */
export async function unratedTop(tx: Tx, n = 4) {
  const [rows, stats] = await Promise.all([pendingCandidates(tx, currentPeriod()), assessmentStats(tx)]);
  return rows.slice(0, n).map((r) => ({ id: r.id, fullName: r.fullName, nameKatakana: r.nameKatakana, latestAvg: stats.get(r.id)?.latestAvg ?? null }));
}

/** Keputusan TSK atas kandidat LPK ini: jumlah per keputusan paling maju (view; tanpa catatan dan tanpa job order). */
export async function decisionBars(tx: Tx): Promise<Array<{ decision: SelectionDecision; n: number }>> {
  return tx
    .select({ decision: candidateHeadlineDecision.decision, n: sql<number>`count(*)::int` })
    .from(candidateHeadlineDecision)
    .groupBy(candidateHeadlineDecision.decision);
}

export async function stageCounts(tx: Tx) {
  return tx.select({ stage: candidates.stage, n: sql<number>`count(*)::int` }).from(candidates).groupBy(candidates.stage);
}

/** Rata-rata empat aspek penilaian LPK_MONTHLY per bulan, 6 bulan PENUH terakhir (tanpa bulan berjalan); bulan tanpa data tidak muncul. */
export async function scoreTrend(tx: Tx, months = 6) {
  const from = periodMonthsAgo(months);
  const to = currentPeriod(); // bulan berjalan tidak ikut
  const res = await tx.execute(sql`
    select period::text as period,
      avg(score_japanese)::float8 as japanese, avg(score_attitude)::float8 as attitude,
      avg(score_fitness)::float8 as fitness, avg(score_motivation)::float8 as motivation, count(*)::int as n
    from candidate_assessments
    where kind = 'LPK_MONTHLY' and period >= ${from}::date and period < ${to}::date
    group by period order by period`);
  return res.rows as Array<{ period: string; japanese: number | null; attitude: number | null; fitness: number | null; motivation: number | null; n: number }>;
}

/** Sensei: 5 penilaian bulanan terakhir yang ia tulis sendiri. */
export async function myAssessments(tx: Tx, userId: string, n = 5) {
  const res = await tx.execute(sql`
    select a.id::text as id, c.id::text as candidate_id, c.full_name, a.assessed_on::text as assessed_on,
      (coalesce(a.score_japanese, 0) + coalesce(a.score_attitude, 0) + coalesce(a.score_fitness, 0) + coalesce(a.score_motivation, 0))::float8
        / nullif((a.score_japanese is not null)::int + (a.score_attitude is not null)::int + (a.score_fitness is not null)::int + (a.score_motivation is not null)::int, 0) as avg
    from candidate_assessments a join candidates c on c.id = a.candidate_id
    where a.kind = 'LPK_MONTHLY' and a.assessor_id = ${userId}::uuid
    order by a.assessed_on desc, a.created_at desc limit ${n}`);
  return res.rows as Array<{ id: string; candidate_id: string; full_name: string; assessed_on: string; avg: number | null }>;
}

/** Sensei: perlu perhatian = kehadiran penilaian terakhir < 80, atau rata-rata turun >= 0,5 dari penilaian sebelumnya. */
export async function attentionList(tx: Tx) {
  const res = await tx.execute(sql`
    select t.candidate_id::text as id, c.full_name, c.name_katakana, t.attendance_pct, t.avg_score, t.prev_avg
    from (
      select a.candidate_id, a.attendance_pct,
        ( coalesce(a.score_japanese, 0) + coalesce(a.score_attitude, 0) + coalesce(a.score_fitness, 0) + coalesce(a.score_motivation, 0) )::float8
          / nullif( (a.score_japanese is not null)::int + (a.score_attitude is not null)::int + (a.score_fitness is not null)::int + (a.score_motivation is not null)::int, 0) as avg_score,
        lag(( coalesce(a.score_japanese, 0) + coalesce(a.score_attitude, 0) + coalesce(a.score_fitness, 0) + coalesce(a.score_motivation, 0) )::float8
          / nullif( (a.score_japanese is not null)::int + (a.score_attitude is not null)::int + (a.score_fitness is not null)::int + (a.score_motivation is not null)::int, 0))
          over (partition by a.candidate_id order by a.assessed_on, a.created_at) as prev_avg,
        row_number() over (partition by a.candidate_id order by a.assessed_on desc, a.created_at desc) as rn
      from candidate_assessments a where a.kind = 'LPK_MONTHLY'
    ) t join candidates c on c.id = t.candidate_id
    where t.rn = 1 and c.stage <> 'WITHDRAWN' and (t.attendance_pct < 80 or (t.prev_avg is not null and t.avg_score <= t.prev_avg - 0.5))
    order by c.full_name`);
  return res.rows as Array<{ id: string; full_name: string; name_katakana: string | null; attendance_pct: number | null; avg_score: number | null; prev_avg: number | null }>;
}

// ------------------------------------------------------------------------------------------------ TSK

export async function tskKpis(tx: Tx) {
  const [newShared, awaiting, placed] = await Promise.all([viewCandidateIds(tx, "new-shared"), viewCandidateIds(tx, "awaiting"), viewCandidateIds(tx, "placed")]);
  const jobs = (
    await tx.execute(sql`
      select j.positions::int as positions,
        (select count(distinct s.candidate_id) from candidate_selections s where s.job_order_id = j.id and s.decision in ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED'))::int as selected
      from job_orders j where j.status = 'OPEN'`)
  ).rows as Array<{ positions: number; selected: number }>;
  return {
    newShared: newShared.length,
    awaiting: awaiting.length,
    openJobs: jobs.length,
    openPositionsLeft: jobs.reduce((n, j) => n + Math.max(0, j.positions - j.selected), 0),
    placed: placed.length,
  };
}

/** Alur seleksi: kandidat (bukan Mundur) per keputusan paling maju; "belum diputuskan" = tanpa keputusan atau NONE. */
export async function pipelineCounts(tx: Tx) {
  const cands = await tx.select({ id: candidates.id }).from(candidates).where(ne(candidates.stage, "WITHDRAWN"));
  const rows = await tx.select({ id: candidateHeadlineDecision.candidateId, d: candidateHeadlineDecision.decision }).from(candidateHeadlineDecision);
  const byId = new Map(rows.map((r) => [r.id, r.d]));
  const out = new Map<string, number>();
  for (const c of cands) {
    const d = byId.get(c.id) ?? "NONE";
    out.set(d, (out.get(d) ?? 0) + 1);
  }
  return out;
}

/** Job order terbuka beserta jumlah terpilih (batang kemajuan). */
export async function openJobs(tx: Tx, n = 5) {
  const res = await tx.execute(sql`
    select j.id::text as id, j.title, j.positions::int as positions, j.min_jlpt, j.jft_required, j.gender_requirement::text as gender,
      s.name as site_name, c.name as company_name, f.name_id, f.name_ja,
      (select count(distinct x.candidate_id) from candidate_selections x where x.job_order_id = j.id and x.decision in ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED'))::int as selected
    from job_orders j join client_sites s on s.id = j.site_id join client_companies c on c.id = s.company_id join skill_fields f on f.id = j.field_id
    where j.status = 'OPEN' order by j.application_deadline nulls last, j.created_at desc limit ${n}`);
  return res.rows as Array<{ id: string; title: string; positions: number; min_jlpt: string | null; jft_required: boolean; gender: string | null; site_name: string; company_name: string; name_id: string; name_ja: string; selected: number }>;
}

/** "Kandidat baru dari LPK": paling baru dibagikan (n teratas) dengan LPK, bidang, JLPT tertinggi, dan rata-rata nilai terakhir. */
export async function newCandidatesTop(tx: Tx, n = 3) {
  const rows = await tx
    .select({ id: candidates.id, fullName: candidates.fullName, nameKatakana: candidates.nameKatakana, lpkName: organizations.name, fieldNameId: skillFields.nameId, fieldNameJa: skillFields.nameJa, at: candidates.sharedWithTskAt })
    .from(candidates)
    .innerJoin(organizations, eq(organizations.id, candidates.organizationId))
    .leftJoin(skillFields, eq(skillFields.id, candidates.fieldId))
    .where(and(eq(candidates.sharedWithTsk, true), ne(candidates.stage, "WITHDRAWN")))
    .orderBy(desc(candidates.sharedWithTskAt), asc(candidates.fullName))
    .limit(n);
  if (rows.length === 0) return [];
  const [stats, jlpt] = await Promise.all([assessmentStats(tx), jlptBest(tx)]);
  return rows.map((r) => ({ ...r, jlpt: jlpt.get(r.id) ?? null, latestAvg: stats.get(r.id)?.latestAvg ?? null }));
}
