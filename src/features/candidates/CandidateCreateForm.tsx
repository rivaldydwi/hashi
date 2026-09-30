"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { gender } from "@/db/schema";
import { idle, type FormState } from "@/lib/form-state";
import { checkFileSize } from "@/features/documents/DocumentForms";
import { addCandidate } from "./actions";

export function CandidateCreateForm({ fieldSuggestions, maxDate }: { fieldSuggestions: string[]; maxDate: string }) {
  const t = useTranslations("candidates");
  const tc = useTranslations("common");
  const td = useTranslations("detail.documents");
  const [state, action] = useActionState<FormState, FormData>(addCandidate, idle);

  return (
    <form action={action} className={`${cardClass} max-w-xl space-y-4 p-6`}>
      <div className="space-y-1.5">
        <label htmlFor="fullName" className={labelClass}>{t("fullName")}</label>
        <input id="fullName" name="fullName" required maxLength={120} autoComplete="off" className={inputClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="gender" className={labelClass}>{t("gender")}</label>
          <select id="gender" name="gender" required defaultValue="" className={inputClass}>
            <option value="" disabled>—</option>
            {gender.enumValues.map((g) => (
              <option key={g} value={g}>{t(`genders.${g}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="birthDate" className={labelClass}>{t("birthDate")}</label>
          <input id="birthDate" name="birthDate" type="date" required min="1930-01-01" max={maxDate} className={inputClass} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="field" className={labelClass}>{t("field")}</label>
        <input id="field" name="field" required maxLength={120} list="field-suggestions" autoComplete="off" className={inputClass} />
        <datalist id="field-suggestions">
          {fieldSuggestions.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="text-xs text-stone-500">{t("fieldHint")}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="dataConsentDate" className={labelClass}>{t("consentDate")}</label>
        <input id="dataConsentDate" name="dataConsentDate" type="date" required max={maxDate} className={inputClass} />
        <p className="text-xs text-stone-500">{t("consentHint")}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="consentForm" className={labelClass}>{t("consentForm")}</label>
        <input
          id="consentForm"
          name="consentForm"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(e) => checkFileSize(e.currentTarget, td("errors.tooBig"))}
          className={inputClass}
        />
        <p className="text-xs text-stone-500">{t("consentFormHint")}</p>
      </div>
      <FormAlert state={state} />
      <div className="flex gap-2">
        <SubmitButton>{t("add")}</SubmitButton>
        <Link href="/candidates" className={btnSecondary}>{tc("cancel")}</Link>
      </div>
    </form>
  );
}
