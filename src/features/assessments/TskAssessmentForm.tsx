"use client";

import { startTransition, useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/FormBits";
import { btnPrimary, labelClass } from "@/components/styles";
import { FieldInputs } from "@/features/candidates/DetailForms";
import { idle, type FormState } from "@/lib/form-state";
import { TSK_ASSESSMENT_FIELDS } from "./fields";
import { saveTskAssessment } from "./tsk-actions";

type Values = Record<string, string | boolean>;

/** Form penilaian TSK (kunjungan / interview; baru atau ubah). Pola kirim sama dengan AssessmentForm (isian tidak hilang saat error). */
export function TskAssessmentForm({
  candidateId,
  kind,
  assessmentId,
  values,
  visibility,
  maxDate,
}: {
  candidateId: string;
  kind: "TSK_VISIT" | "TSK_INTERVIEW";
  assessmentId?: string;
  values: Values;
  visibility: "TSK_ONLY" | "SHARED_WITH_LPK";
  /** Batas tanggal: hari ini di Tokyo (sama dengan trigger). */
  maxDate: string;
}) {
  const t = useTranslations("assessments");
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveTskAssessment, idle);
  const prefix = `tsk-${kind === "TSK_VISIT" ? "visit" : "interview"}${assessmentId ? `-${assessmentId.slice(0, 8)}` : ""}`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      key={assessmentId ? JSON.stringify({ values, visibility }) : undefined}
      className="space-y-4 pt-3"
      data-testid={`form-${prefix}`}
    >
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="kind" value={kind} />
      {assessmentId && <input type="hidden" name="assessmentId" value={assessmentId} />}
      <FieldInputs section="assessment" idPrefix={prefix} fields={TSK_ASSESSMENT_FIELDS} values={values} dateMax={{ assessedOn: maxDate }} hintNames={["note"]} autoFilled={assessmentId ? [] : ["assessedOn"]} />
      <fieldset className="space-y-1">
        <legend className={labelClass}>{t("tsk.visibility")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="visibility" value="TSK_ONLY" defaultChecked={visibility === "TSK_ONLY"} /> {t("tsk.tskOnly")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="visibility" value="SHARED_WITH_LPK" defaultChecked={visibility === "SHARED_WITH_LPK"} /> {t("tsk.shared")}
        </label>
        <p className="text-xs text-amber-800">{t("tsk.shareWarning")}</p>
      </fieldset>
      <FormAlert state={state} />
      <button type="submit" disabled={pending} className={btnPrimary} data-testid="assessment-submit">
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
