"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { assessmentAuditEntry } from "@/db/audit-entries";
import { todayInTskTz } from "@/db/time";
import { candidateAssessments } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { ActionError } from "@/lib/errors";
import { tenantQuery } from "@/lib/session";
import { getCandidateForAction } from "@/features/candidates/detail-queries";
import { ok, run, uuid } from "@/features/candidates/guards";
import { isTskRole, TSK_INTERVIEW_DECISIONS } from "@/features/candidates/permissions";
import { buildSchema } from "@/features/candidates/sections";
import { TSK_ASSESSMENT_FIELDS } from "./fields";

const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);

/**
 * Buat atau ubah penilaian TSK: kunjungan (TSK_VISIT, kapan saja) atau interview (TSK_INTERVIEW, hanya setelah keputusan
 * TSK itu termasuk TSK_INTERVIEW_DECISIONS). Milik organisasi TSK pelaku; visibility TSK_ONLY (bawaan) atau SHARED_WITH_LPK.
 * Batas tanggal = hari ini di Tokyo (sama dengan trigger). Hak ubah (penilainya atau TSK_ADMIN) dijaga RLS.
 * Audit hanya memuat NAMA kolom dan visibility, tidak pernah isi catatan (log kandidat dibaca LPK).
 */
export async function saveTskAssessment(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const kind = formData.get("kind");
    const visibility = formData.get("visibility");
    if (!isTskRole(me.role) || !uuid.safeParse(formData.get("candidateId")).success || (kind !== "TSK_VISIT" && kind !== "TSK_INTERVIEW")) {
      return { status: "error", key: "detail.errors.readOnly" };
    }
    if (visibility !== "TSK_ONLY" && visibility !== "SHARED_WITH_LPK") return { status: "error", key: "common.invalidInput" };
    const assessmentId = formData.get("assessmentId");
    if (assessmentId && !uuid.safeParse(assessmentId).success) return { status: "error", key: "common.invalidInput" };

    const parsed = buildSchema(TSK_ASSESSMENT_FIELDS).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { status: "error", key: "common.invalidInput" };
    const v = parsed.data as Record<string, string | number | null>;
    const assessedOn = v.assessedOn as string;
    if (assessedOn > todayInTskTz()) return { status: "error", key: "assessments.errors.future" };
    if (assessedOn < "2000-01-01") return { status: "error", key: "common.invalidInput" };

    const score = (name: string) => (v[name] === null || v[name] === undefined ? null : Number(v[name]));
    const values = {
      assessedOn,
      durationMinutes: v.durationMinutes as number,
      scoreJapanese: score("scoreJapanese"),
      scoreAttitude: score("scoreAttitude"),
      scoreFitness: score("scoreFitness"),
      scoreMotivation: score("scoreMotivation"),
      note: v.note as string | null,
      followUp: v.followUp as string | null,
    };
    const candidateId = formData.get("candidateId") as string;

    await tenantQuery(async (tx) => {
      const cand = await getCandidateForAction(tx, me, candidateId);
      if (!cand) throw new ActionError("detail.errors.notFound"); // tidak ada / tidak terlihat (RLS)

      if (assessmentId) {
        const [before] = await tx
          .select()
          .from(candidateAssessments)
          .where(and(eq(candidateAssessments.id, assessmentId as string), eq(candidateAssessments.candidateId, candidateId), eq(candidateAssessments.kind, kind)));
        if (!before) throw new ActionError("detail.errors.notFound");
        const done = await tx
          .update(candidateAssessments)
          .set({ ...values, visibility })
          .where(eq(candidateAssessments.id, before.id))
          .returning({ id: candidateAssessments.id, period: candidateAssessments.period });
        if (done.length !== 1) throw new ActionError("assessments.errors.notAllowed"); // RLS: bukan penilainya / bukan TSK_ADMIN
        const changed = TSK_ASSESSMENT_FIELDS.filter((f) => norm((before as Record<string, unknown>)[f.name]) !== norm((values as Record<string, unknown>)[f.name])).map((f) => f.name);
        if (changed.length || before.visibility !== visibility) {
          await audit(tx, assessmentAuditEntry({ action: "assessment.update", assessment: { id: before.id, candidateId, kind, period: done[0].period }, lpkOrgId: cand.organizationId, actorOrgId: me.organizationId, actorUserId: me.id, changed, visibility: { from: before.visibility, to: visibility } }));
        }
      } else {
        if (kind === "TSK_INTERVIEW" && !(cand.myDecision && TSK_INTERVIEW_DECISIONS.includes(cand.myDecision))) {
          throw new ActionError("assessments.errors.interviewNotAllowed");
        }
        const [row] = await tx
          .insert(candidateAssessments)
          .values({ candidateId, orgId: me.organizationId, kind, visibility, ...values })
          .returning({ id: candidateAssessments.id, period: candidateAssessments.period });
        const changed = TSK_ASSESSMENT_FIELDS.filter((f) => norm((values as Record<string, unknown>)[f.name]) !== null).map((f) => f.name);
        await audit(tx, assessmentAuditEntry({ action: "assessment.create", assessment: { id: row.id, candidateId, kind, period: row.period }, lpkOrgId: cand.organizationId, actorOrgId: me.organizationId, actorUserId: me.id, changed, visibility: { to: visibility } }));
      }
    });
    revalidatePath(`/candidates/${candidateId}`);
    return ok("assessments.saved");
  });
}
