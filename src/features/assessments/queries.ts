import { and, asc, desc, eq, isNull, inArray, ne } from "drizzle-orm";
import type { Tx } from "@/db";
export { assessmentStats, jlptBest, matchAssessmentFilters, type Stats } from "@/db/candidate-list";
import { candidateAssessments, candidates, organizations, skillFields, users } from "@/db/schema";

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

export { pendingCandidates } from "@/db/candidate-list";

/**
 * Penilaian TSK (kunjungan / interview) satu kandidat, terbaru dulu. RLS yang menentukan isinya: TSK hanya melihat milik
 * organisasinya, LPK_ADMIN hanya yang dibagikan (SHARED_WITH_LPK) oleh TSK mitra aktif. Nama penilai bisa kosong
 * (pengguna TSK tidak terbaca LPK), jadi nama organisasi TSK ikut diambil.
 */
export function listTsk(tx: Tx, candidateId: string) {
  return tx
    .select({
      id: candidateAssessments.id,
      kind: candidateAssessments.kind,
      assessedOn: candidateAssessments.assessedOn,
      durationMinutes: candidateAssessments.durationMinutes,
      scoreJapanese: candidateAssessments.scoreJapanese,
      scoreAttitude: candidateAssessments.scoreAttitude,
      scoreFitness: candidateAssessments.scoreFitness,
      scoreMotivation: candidateAssessments.scoreMotivation,
      note: candidateAssessments.note,
      followUp: candidateAssessments.followUp,
      visibility: candidateAssessments.visibility,
      assessorId: candidateAssessments.assessorId,
      assessorName: users.name,
      orgName: organizations.name,
    })
    .from(candidateAssessments)
    .innerJoin(organizations, eq(organizations.id, candidateAssessments.orgId))
    .leftJoin(users, eq(users.id, candidateAssessments.assessorId))
    .where(and(eq(candidateAssessments.candidateId, candidateId), ne(candidateAssessments.kind, "LPK_MONTHLY")))
    .orderBy(desc(candidateAssessments.assessedOn), desc(candidateAssessments.createdAt));
}
export type TskRow = Awaited<ReturnType<typeof listTsk>>[number];
