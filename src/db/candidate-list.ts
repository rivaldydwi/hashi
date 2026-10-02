// Daftar kandidat + filter nilai/kehadiran/JLPT. Ada di src/db (bukan src/features) supaya script (verify:seed)
// memakai fungsi YANG SAMA dengan halaman /candidates; aturannya tidak ditulis ulang di tempat lain.
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { isFilterView, viewCandidateIds, type FilterView } from "./dashboard-queries";
import {
  candidateAssessments,
  candidateCertificates,
  candidateHeadlineDecision,
  candidates,
  candidateStage,
  organizations,
  selectionDecision,
  skillFields,
  type CandidateStage,
  type SelectionDecision,
} from "./schema";

export const LIST_PAGE_SIZE = 25;

export type CandidateFilters = {
  q: string;
  stage: CandidateStage | "";
  /** Kode bidang kerja (skill_fields.code); "" = semua. */
  field: string;
  /** Hanya untuk TSK: keputusan TSK itu sendiri. NONE = belum ada baris keputusan atau NONE. */
  decision: SelectionDecision | "";
  /** Rata-rata nilai minimal (1-5), dari tiga penilaian bulanan LPK terbaru. "" = tidak difilter. */
  avg: string;
  /** Kehadiran rata-rata minimal (0-100), dari tiga penilaian bulanan terbaru. */
  attendance: string;
  /** Level JLPT tertinggi minimal, mis. "N4" = N4 atau lebih tinggi. */
  jlpt: string;
  /** Filter kartu dashboard (lihat dashboard-queries.ts); "" = tidak ada. Menyempit ke himpunan id yang sama dengan angka di kartu. */
  view: string;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Angka dari URL dalam rentang [min, max], dikembalikan sebagai string bersih; nilai tak valid = "" (diabaikan). */
function numberParam(v: string | string[] | undefined, min: number, max: number): string {
  const s = one(v).replace(",", ".");
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n >= min && n <= max ? String(n) : "";
}

/** Baca filter dari URL. Nilai yang tidak dikenal diabaikan (bukan error), supaya URL lama tidak rusak. */
export function parseFilters(sp: Params, isTsk: boolean): CandidateFilters {
  const stage = one(sp.stage);
  const decision = one(sp.decision);
  const page = Number.parseInt(one(sp.page), 10);
  return {
    q: one(sp.q).slice(0, 100),
    stage: (candidateStage.enumValues as readonly string[]).includes(stage) ? (stage as CandidateStage) : "",
    field: /^[a-z0-9][a-z0-9-]{0,39}$/.test(one(sp.field)) ? one(sp.field) : "",
    decision: isTsk && (selectionDecision.enumValues as readonly string[]).includes(decision) ? (decision as SelectionDecision) : "",
    avg: numberParam(sp.avg, 1, 5),
    attendance: numberParam(sp.attendance, 0, 100),
    jlpt: /^N[1-5]$/.test(one(sp.jlpt)) ? one(sp.jlpt) : "",
    view: isFilterView(one(sp.view), isTsk) ? one(sp.view) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Escape karakter khusus LIKE supaya "50%" dicari apa adanya. */
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

// LPK tidak punya "TSK sendiri": join keputusan memakai UUID nol, sehingga selalu kosong.
const NO_TSK = "00000000-0000-0000-0000-000000000000";

/**
 * Daftar kandidat yang terlihat oleh pemanggil (RLS yang menentukan: LPK = miliknya, TSK = mitra
 * dengan persetujuan data). `tskOrgId` diisi untuk TSK supaya keputusan miliknya ikut ditampilkan.
 */
export async function listCandidates(tx: Tx, filters: CandidateFilters, tskOrgId: string | null, onlyIds: string[] | null = null) {
  const conds = [];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conds.push(or(ilike(candidates.fullName, pattern), ilike(candidates.nameKatakana, pattern)));
  }
  if (filters.stage) conds.push(eq(candidates.stage, filters.stage));
  if (filters.field) conds.push(eq(skillFields.code, filters.field));
  if (tskOrgId && filters.decision) {
    conds.push(
      filters.decision === "NONE"
        ? or(isNull(candidateHeadlineDecision.decision), eq(candidateHeadlineDecision.decision, "NONE"))
        : eq(candidateHeadlineDecision.decision, filters.decision),
    );
  }
  // Filter nilai/kehadiran/JLPT dihitung di query terpisah (assessments/queries.ts), lalu dipasang sebagai daftar id
  if (onlyIds) conds.push(onlyIds.length ? inArray(candidates.id, onlyIds) : sql`false`);
  const where = conds.length ? and(...conds) : undefined;
  // Keputusan paling maju kandidat ini di TSK pemanggil (satu baris per kandidat; lihat view candidate_headline_decision)
  const ownDecision = and(eq(candidateHeadlineDecision.candidateId, candidates.id), eq(candidateHeadlineDecision.tskOrgId, tskOrgId ?? NO_TSK));

  const [{ total }] = await tx
    .select({ total: count() })
    .from(candidates)
    .leftJoin(skillFields, eq(skillFields.id, candidates.fieldId))
    .leftJoin(candidateHeadlineDecision, ownDecision)
    .where(where);

  const rows = await tx
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      nameKatakana: candidates.nameKatakana,
      fieldCode: skillFields.code,
      fieldNameId: skillFields.nameId,
      fieldNameJa: skillFields.nameJa,
      stage: candidates.stage,
      lpkName: organizations.name,
      decision: candidateHeadlineDecision.decision,
      sharedWithTsk: candidates.sharedWithTsk,
    })
    .from(candidates)
    .innerJoin(organizations, eq(organizations.id, candidates.organizationId))
    .leftJoin(skillFields, eq(skillFields.id, candidates.fieldId))
    .leftJoin(candidateHeadlineDecision, ownDecision)
    .where(where)
    .orderBy(desc(candidates.createdAt), asc(candidates.fullName), asc(candidates.id))
    .limit(LIST_PAGE_SIZE)
    .offset((filters.page - 1) * LIST_PAGE_SIZE);

  return { rows, total };
}

export type CandidateListRow = Awaited<ReturnType<typeof listCandidates>>["rows"][number];

export { listSkillFields } from "./skill-fields";

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


/**
 * Daftar kandidat untuk halaman /candidates: filter dasar (teks, status, bidang, keputusan) + filter nilai, kehadiran, dan
 * JLPT. Statistik penilaian dan JLPT dihitung di query terpisah (tanpa subquery berkorelasi), lalu dipasang sebagai daftar id.
 * `stats` ikut dikembalikan untuk kolom "Nilai terakhir".
 */
export async function listCandidatesFiltered(tx: Tx, filters: CandidateFilters, tskOrgId: string | null) {
  const stats = await assessmentStats(tx);
  const onlyIds =
    filters.avg || filters.attendance || filters.jlpt
      ? matchAssessmentFilters(filters, stats, await jlptBest(tx), (await tx.select({ id: candidates.id }).from(candidates)).map((r) => r.id))
      : null;
  // Filter kartu dashboard: irisan dengan filter nilai/JLPT bila ada
  let ids = onlyIds;
  if (filters.view) {
    const viewIds = await viewCandidateIds(tx, filters.view as FilterView);
    ids = ids === null ? viewIds : ids.filter((id) => viewIds.includes(id));
  }
  return { list: await listCandidates(tx, filters, tskOrgId, ids), stats };
}

/** Kandidat berstatus Belajar / Siap seleksi yang BELUM punya LPK_MONTHLY pada `period` (awal bulan berjalan). */
export function pendingCandidates(tx: Tx, period: string) {
  return tx
    .select({ id: candidates.id, fullName: candidates.fullName, nameKatakana: candidates.nameKatakana, fieldNameId: skillFields.nameId, fieldNameJa: skillFields.nameJa, stage: candidates.stage })
    .from(candidates)
    .leftJoin(skillFields, eq(skillFields.id, candidates.fieldId))
    .leftJoin(
      candidateAssessments,
      and(eq(candidateAssessments.candidateId, candidates.id), eq(candidateAssessments.kind, "LPK_MONTHLY"), eq(candidateAssessments.period, period)),
    )
    .where(and(inArray(candidates.stage, ["STUDYING", "READY"]), isNull(candidateAssessments.id)))
    .orderBy(asc(candidates.fullName), asc(candidates.id));
}

