"use client";

import { ORG_TIMEZONES } from "@/lib/org-time";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { cardClass, inputClass, labelClass } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { updateOrganization } from "./actions";

type Org = { id: string; name: string; type: "PLATFORM" | "LPK" | "TSK"; country: string; defaultLocale: "id" | "ja"; timezone: string };

export function OrgEditForm({ org }: { org: Org }) {
  const t = useTranslations();
  const [state, action] = useActionState<FormState, FormData>(updateOrganization, idle);

  return (
    <form action={action} className={`${cardClass} space-y-4 p-6`}>
      <h2 className="font-medium">{t("orgs.detailTitle")}</h2>
      <input type="hidden" name="id" value={org.id} />
      <div className="space-y-1.5">
        <label htmlFor="name" className={labelClass}>{t("orgs.fieldName")}</label>
        <input id="name" name="name" defaultValue={org.name} required maxLength={160} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="type" className={labelClass}>{t("orgs.fieldType")}</label>
        <input id="type" value={t(`orgTypes.${org.type}`)} disabled className={inputClass} />
        <p className="text-xs text-stone-500">{t("orgs.typeLocked")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="country" className={labelClass}>{t("orgs.fieldCountry")}</label>
          <select id="country" name="country" defaultValue={org.country} className={inputClass}>
            <option value="ID">{t("countries.ID")}</option>
            <option value="JP">{t("countries.JP")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="defaultLocale" className={labelClass}>{t("orgs.fieldDefaultLocale")}</label>
          <select id="defaultLocale" name="defaultLocale" defaultValue={org.defaultLocale} className={inputClass}>
            <option value="id">{t("languages.id")}</option>
            <option value="ja">{t("languages.ja")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="timezone" className={labelClass}>{t("orgs.fieldTimezone")}</label>
          <select id="timezone" name="timezone" defaultValue={org.timezone} className={inputClass}>
            {ORG_TIMEZONES.map((z) => <option key={z} value={z}>{t(`orgs.timezones.${z}`)}</option>)}
          </select>
        </div>
      </div>
      <FormAlert state={state} />
      <SubmitButton>{t("common.save")}</SubmitButton>
    </form>
  );
}
