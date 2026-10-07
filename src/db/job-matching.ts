// Pencocokan kandidat untuk job order (dipakai halaman "Kandidat cocok" dan verify:seed). Memakai fungsi yang sama dengan
// halaman kandidat: statistik penilaian (assessmentStats), JLPT tertinggi (jlptBest), dan view keputusan paling maju.
import { inSeries } from "./serial";
import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "./index";
import { assessmentStats, jlptBest } from "./candidate-list";
import {
  candidateCertificates,
  candidateHeadlineDecision,
  candidateSelections,
  candidates,
  organizations,
  placements,
  type SelectionDecision,
} from "./schema";

/** Skor JFT-Basic minimum yang dianggap lulus. */
export const JFT_PASS_SCORE = 200;

export type MatchJobOrder = { id: string; fieldId: string; minJlpt: string | null; jftRequired: boolean; genderRequirement: "MALE" | "FEMALE" | null };

export type MatchRow = {
  id: string;
  fullName: string;
  nameKatakana: string | null;
  stage: "STUDYING" | "READY" | "WITHDRAWN";
  lpkName: string;
  gender: "MALE" | "FEMALE" | null;
  latestAvg: number | null;
  /** Keputusan paling maju TSK ini atas kandidat (semua job order). */
  headline: SelectionDecision | null;
  /** Keputusan untuk job order INI (null = belum diajukan). */
  forThisJobOrder: SelectionDecision | null;
  /** Sudah punya penempatan aktif (tidak bisa diajukan lagi). */
  placed: boolean;
  /** Kelayakan per syarat: true = memenuhi, false = tidak, null = job order tidak mensyaratkan. */
  jlptOk: boolean | null;
  jftOk: boolean | null;
  genderOk: boolean | null;
};

/**
 * Kandidat yang boleh dilihat TSK (RLS: dibagikan) dengan bidang yang sama dengan job order, selain yang Mundur. Syarat bahasa dan gender
 * ditandai, tidak menyembunyikan kandidat. Urut: rata-rata nilai bulanan terbaru (tertinggi dulu; belum dinilai di akhir), lalu nama.
 */
export async function matchCandidates(tx: Tx, jo: MatchJobOrder, tskOrgId: string): Promise<MatchRow[]> {
  const base = await tx
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      nameKatakana: candidates.nameKatakana,
      stage: candidates.stage,
      gender: candidates.gender,
      lpkName: organizations.name,
    })
    .from(candidates)
    .innerJoin(organizations, eq(organizations.id, candidates.organizationId))
    .where(and(eq(candidates.fieldId, jo.fieldId), inArray(candidates.stage, ["STUDYING", "READY"])))
    .orderBy(asc(candidates.fullName), asc(candidates.id));
  if (base.length === 0) return [];
  const ids = base.map((c) => c.id);
  const [stats, jlpt, jft, headline, mine, placed] = await inSeries(
    () => assessmentStats(tx),
    () => jlptBest(tx),
    () => tx.select({ id: candidateCertificates.candidateId }) .from(candidateCertificates) .where(and(eq(candidateCertificates.type, "JFT_BASIC"), isNotNull(candidateCertificates.score), gte(candidateCertificates.score, JFT_PASS_SCORE), inArray(candidateCertificates.candidateId, ids))),
    () => tx.select({ id: candidateHeadlineDecision.candidateId, d: candidateHeadlineDecision.decision }) .from(candidateHeadlineDecision) .where(and(eq(candidateHeadlineDecision.tskOrgId, tskOrgId), inArray(candidateHeadlineDecision.candidateId, ids))),
    () => tx.select({ id: candidateSelections.candidateId, d: candidateSelections.decision }) .from(candidateSelections) .where(and(eq(candidateSelections.jobOrderId, jo.id), inArray(candidateSelections.candidateId, ids))),
    () => tx.select({ id: placements.candidateId }).from(placements).where(and(eq(placements.status, "ACTIVE"), inArray(placements.candidateId, ids))),
  );
  const jftSet = new Set(jft.map((r) => r.id));
  const headlineMap = new Map(headline.map((r) => [r.id, r.d]));
  const mineMap = new Map(mine.map((r) => [r.id, r.d]));
  const placedSet = new Set(placed.map((r) => r.id));
  const minN = jo.minJlpt ? Number(jo.minJlpt.slice(1)) : null;
  const rows: MatchRow[] = base.map((c) => ({
    ...c,
    latestAvg: stats.get(c.id)?.latestAvg ?? null,
    headline: headlineMap.get(c.id) ?? null,
    forThisJobOrder: mineMap.get(c.id) ?? null,
    placed: placedSet.has(c.id),
    jlptOk: minN === null ? null : (jlpt.get(c.id) ?? 99) <= minN, // angka N lebih kecil = level lebih tinggi
    jftOk: jo.jftRequired ? jftSet.has(c.id) : null,
    genderOk: jo.genderRequirement ? c.gender === jo.genderRequirement : null,
  }));
  return rows.sort((a, b) => (b.latestAvg ?? -1) - (a.latestAvg ?? -1) || a.fullName.localeCompare(b.fullName));
}
