import { and, asc, desc, eq, isNull, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { candidateAssessments, candidateCertificates, candidates, users } from "@/db/schema";

/** Riwayat penilaian bulanan LPK satu kandidat (terbaru dulu), dengan nama penilai bila terbaca. */
export function listMonthly(tx: Tx, candidateId: string) {
  return tx
    .select({
      id: candidateAssessments.id,
      assessedOn: candidateAssessments.assessedOn,
      period: candidateAssessments.period,
      durationMinutes: candidateAssessments.durationMinutes,
      scoreJapanese: candidateAssessments.scoreJapanese,
      scoreAttitude: candidateAssessments.scoreAttitude,
      scoreFitness: candidateAssessments.scoreFitness,
      scoreMotivation: candidateAssessments.scoreMotivation,
      attendancePct: candidateAssessments.attendancePct,
      testName: candidateAssessments.testName,
      testScore: candidateAssessments.testScore,
      note: candidateAssessments.note,
      followUp: candidateAssessments.followUp,
      assessorId: candidateAssessments.assessorId,
      assessorName: users.name,
    })
    .from(candidateAssessments)
    .leftJoin(users, eq(users.id, candidateAssessments.assessorId))
    .where(and(eq(candidateAssessments.candidateId, candidateId), eq(candidateAssessments.kind, "LPK_MONTHLY")))
    .orderBy(desc(candidateAssessments.assessedOn), desc(candidateAssessments.createdAt));
}
export type MonthlyRow = Awaited<ReturnType<typeof listMonthly>>[number];

/** Kandidat berstatus Belajar / Siap seleksi yang BELUM punya LPK_MONTHLY pada `period` (awal bulan berjalan). */
export function pendingCandidates(tx: Tx, period: string) {
  return tx
    .select({ id: candidates.id, fullName: candidates.fullName, nameKatakana: candidates.nameKatakana, field: candidates.field, stage: candidates.stage })
    .from(candidates)
    .leftJoin(
      candidateAssessments,
      and(eq(candidateAssessments.candidateId, candidates.id), eq(candidateAssessments.kind, "LPK_MONTHLY"), eq(candidateAssessments.period, period)),
    )
    .where(and(inArray(candidates.stage, ["STUDYING", "READY"]), isNull(candidateAssessments.id)))
    .orderBy(asc(candidates.fullName), asc(candidates.id));
}

export type Stats = { latestAvg: number | null; latestPeriod: string; avg3: number | null; attendance3: number | null };

/**
 * Ringkasan penilaian bulanan LPK per kandidat yang terlihat (RLS yang menentukan): nilai rata-rata terakhir, serta
 * rata-rata nilai dan kehadiran dari TIGA penilaian terbaru. SQL mentah dengan nama tabel eksplisit (bukan kolom
 * Drizzle di dalam sql``), dan GROUP BY/window di satu query, tanpa subquery berkorelasi.
 */
export async function assessmentStats(tx: Tx): Promise<Map<string, Stats>> {
  const res = await tx.execute(sql`
    select t.candidate_id, t.rn, t.period::text as period, t.avg_score::float8 as avg_score, t.attendance_pct::float8 as attendance_pct
    from (
      select a.candidate_id, a.period, a.attendance_pct,
        ( coalesce(a.score_japanese, 0) + coalesce(a.score_attitude, 0) + coalesce(a.score_fitness, 0) + coalesce(a.score_motivation, 0) )::numeric
          / nullif( (a.score_japanese is not null)::int + (a.score_attitude is not null)::int + (a.score_fitness is not null)::int + (a.score_motivation is not null)::int, 0) as avg_score,
        row_number() over (partition by a.candidate_id order by a.assessed_on desc, a.created_at desc) as rn
      from candidate_assessments a
      where a.kind = 'LPK_MONTHLY'
    ) t
    where t.rn <= 3
    order by t.candidate_id, t.rn
  `);
  const grouped = new Map<string, Array<{ rn: number; period: string; avg: number | null; att: number | null }>>();
  for (const r of res.rows as Array<{ candidate_id: string; rn: number | string; period: string; avg_score: number | null; attendance_pct: number | null }>) {
    const list = grouped.get(r.candidate_id) ?? [];
    list.push({ rn: Number(r.rn), period: r.period, avg: r.avg_score, att: r.attendance_pct });
    grouped.set(r.candidate_id, list);
  }
  const mean = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const out = new Map<string, Stats>();
  for (const [id, rows] of grouped) {
    out.set(id, { latestAvg: rows[0].avg, latestPeriod: rows[0].period, avg3: mean(rows.map((r) => r.avg)), attendance3: mean(rows.map((r) => r.att)) });
  }
  return out;
}

/** Level JLPT tertinggi per kandidat (angka N: 1 = tertinggi, 5 = terendah), dari bagian sertifikat. */
export async function jlptBest(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: candidateCertificates.candidateId, level: candidateCertificates.levelOrField })
    .from(candidateCertificates)
    .where(eq(candidateCertificates.type, "JLPT"));
  const best = new Map<string, number>();
  for (const r of rows) {
    const m = /N\s*([1-5])/i.exec(r.level ?? "");
    if (!m) continue;
    const n = Number(m[1]);
    if (!best.has(r.id) || n < best.get(r.id)!) best.set(r.id, n);
  }
  return best;
}

/**
 * Id kandidat yang memenuhi filter nilai/kehadiran/JLPT (semua yang diisi harus terpenuhi), atau null bila tidak ada
 * filter. Kandidat tanpa data yang dibutuhkan (belum dinilai / tanpa JLPT) tidak lolos filter itu.
 */
export function matchAssessmentFilters(
  filters: { avg: string; attendance: string; jlpt: string },
  stats: Map<string, Stats>,
  jlpt: Map<string, number>,
  allIds: Iterable<string>,
): string[] | null {
  if (!filters.avg && !filters.attendance && !filters.jlpt) return null;
  const minAvg = filters.avg ? Number(filters.avg) : null;
  const minAtt = filters.attendance ? Number(filters.attendance) : null;
  const maxN = filters.jlpt ? Number(filters.jlpt.slice(1)) : null; // N4 → N4 atau lebih tinggi (angka <= 4)
  const out: string[] = [];
  for (const id of allIds) {
    const s = stats.get(id);
    if (minAvg !== null && !(s?.avg3 != null && s.avg3 >= minAvg)) continue;
    if (minAtt !== null && !(s?.attendance3 != null && s.attendance3 >= minAtt)) continue;
    if (maxN !== null) {
      const n = jlpt.get(id);
      if (n === undefined || n > maxN) continue;
    }
    out.push(id);
  }
  return out;
}
