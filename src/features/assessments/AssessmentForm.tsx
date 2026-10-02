"use client";

import { startTransition, useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/FormBits";
import { btnPrimary } from "@/components/styles";
import { FieldInputs } from "@/features/candidates/DetailForms";
import { idle, type FormState } from "@/lib/form-state";
import { saveAssessment } from "./actions";
import { ASSESSMENT_FIELDS } from "./fields";

type Values = Record<string, string | boolean>;

/**
 * Form penilaian bulanan (baru atau ubah). Dikirim lewat onSubmit manual supaya isian TIDAK hilang saat ada
 * error (React mengosongkan form-action yang gagal); setelah sukses, halaman dirender ulang dan form dibuat baru
 * (key dari data). Kolom diturunkan dari ASSESSMENT_FIELDS.
 */
export function AssessmentForm({
  candidateId,
  assessmentId,
  values,
  maxDate,
}: {
  candidateId: string;
  assessmentId?: string;
  values: Values;
  /** Batas tanggal: "hari ini" menurut APP_TIMEZONE. */
  maxDate: string;
}) {
  const t = useTranslations("assessments");
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveAssessment, idle);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      key={assessmentId ? JSON.stringify(values) : undefined}
      className="space-y-4 pt-3"
      data-testid={assessmentId ? "form-assessment-edit" : "form-assessment-add"}
    >
      <input type="hidden" name="candidateId" value={candidateId} />
      {assessmentId && <input type="hidden" name="assessmentId" value={assessmentId} />}
      <FieldInputs
        section="assessment"
        idPrefix={assessmentId ? `assessment-${assessmentId.slice(0, 8)}` : "assessment"}
        fields={ASSESSMENT_FIELDS}
        values={values}
        dateMax={{ assessedOn: maxDate }}
        hintNames={["note"]}
        autoFilled={assessmentId ? [] : ["assessedOn", "durationMinutes"]}
      />
      <FormAlert state={state} />
      <button type="submit" disabled={pending} className={btnPrimary} data-testid="assessment-submit">
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
