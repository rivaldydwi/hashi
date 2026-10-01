"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { assessmentAuditEntry } from "@/db/audit-entries";
import { todayInAppTz } from "@/db/time";
import { candidateAssessments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode, PG_UNIQUE_VIOLATION } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery } from "@/lib/session";
import { getCandidateForAction } from "@/features/candidates/detail-queries";
import { ok, run, uuid } from "@/features/candidates/guards";
import { buildSchema } from "@/features/candidates/sections";
import { ASSESSMENT_FIELDS, SCORE_NAMES } from "./fields";

const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);

/**
 * Buat atau ubah penilaian BULANAN LPK (LPK_MONTHLY). Hanya LPK_ADMIN dan sensei, untuk kandidat LPK-nya.
 * Batas tanggal: tidak boleh melewati "hari ini" menurut APP_TIMEZONE (Jakarta). Itu selalu <= tanggal Tokyo yang
 * dipakai trigger database, jadi tanggal hari ini menurut Jakarta tidak pernah ditolak oleh database.
 * Penilai, periode, dan hak ubah (penilainya atau LPK_ADMIN) dijaga database (trigger + RLS).
 */
export async function saveAssessment(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    if ((me.role !== "LPK_ADMIN" && me.role !== "LPK_SENSEI") || !uuid.safeParse(formData.get("candidateId")).success) {
      return { status: "error", key: "detail.errors.readOnly" };
    }
    const assessmentId = formData.get("assessmentId");
    if (assessmentId && !uuid.safeParse(assessmentId).success) return { status: "error", key: "common.invalidInput" };

    const parsed = buildSchema(ASSESSMENT_FIELDS).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { status: "error", key: "common.invalidInput" };
    const v = parsed.data as Record<string, string | number | null>;
    const assessedOn = v.assessedOn as string;
    if (assessedOn > todayInAppTz()) return { status: "error", key: "assessments.errors.future" };
    if (assessedOn < "2000-01-01") return { status: "error", key: "common.invalidInput" };

    const score = (name: string) => (v[name] === null || v[name] === undefined ? null : Number(v[name]));
    const values = {
      assessedOn,
      durationMinutes: v.durationMinutes as number,
      scoreJapanese: score("scoreJapanese"),
      scoreAttitude: score("scoreAttitude"),
      scoreFitness: score("scoreFitness"),
      scoreMotivation: score("scoreMotivation"),
      attendancePct: v.attendancePct as number | null,
      testName: v.testName as string | null,
      testScore: v.testScore as number | null,
      note: v.note as string | null,
      followUp: v.followUp as string | null,
    };
    void SCORE_NAMES;
    const candidateId = formData.get("candidateId") as string;

    try {
      await tenantQuery(async (tx) => {
        const cand = await getCandidateForAction(tx, me, candidateId);
        if (!cand || cand.organizationId !== me.organizationId) throw new ActionError("detail.errors.notFound");

        if (assessmentId) {
          const [before] = await tx
            .select()
            .from(candidateAssessments)
            .where(and(eq(candidateAssessments.id, assessmentId as string), eq(candidateAssessments.candidateId, candidateId), eq(candidateAssessments.kind, "LPK_MONTHLY")));
          if (!before) throw new ActionError("detail.errors.notFound");
          const done = await tx
            .update(candidateAssessments)
            .set(values)
            .where(eq(candidateAssessments.id, before.id))
            .returning({ id: candidateAssessments.id, period: candidateAssessments.period });
          if (done.length !== 1) throw new ActionError("assessments.errors.notAllowed"); // RLS: bukan penilainya / bukan LPK_ADMIN
          const changed = ASSESSMENT_FIELDS.filter((f) => norm((before as Record<string, unknown>)[f.name]) !== norm((values as Record<string, unknown>)[f.name])).map((f) => f.name);
          if (changed.length) {
            await audit(tx, assessmentAuditEntry({ action: "assessment.update", assessment: { id: before.id, candidateId, kind: "LPK_MONTHLY", period: done[0].period }, lpkOrgId: cand.organizationId, actorOrgId: me.organizationId, actorUserId: me.id, changed }));
          }
        } else {
          const [row] = await tx
            .insert(candidateAssessments)
            .values({ candidateId, orgId: me.organizationId, kind: "LPK_MONTHLY", ...values })
            .returning({ id: candidateAssessments.id, period: candidateAssessments.period });
          const changed = ASSESSMENT_FIELDS.filter((f) => norm((values as Record<string, unknown>)[f.name]) !== null).map((f) => f.name);
          await audit(tx, assessmentAuditEntry({ action: "assessment.create", assessment: { id: row.id, candidateId, kind: "LPK_MONTHLY", period: row.period }, lpkOrgId: cand.organizationId, actorOrgId: me.organizationId, actorUserId: me.id, changed }));
        }
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) return { status: "error", key: "assessments.errors.duplicateMonth" };
      throw err;
    }
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/assessments/pending");
    revalidatePath("/");
    return ok("assessments.saved");
  });
}
