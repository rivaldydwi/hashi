"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton, TempPasswordNotice } from "@/components/FormBits";
import { btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { createOrganization } from "./actions";

export function OrgCreateForm() {
  const t = useTranslations();
  const [state, action] = useActionState<FormState, FormData>(createOrganization, idle);

  if (state.status === "success" && state.tempPassword && state.email) {
    return (
      <div className={`${cardClass} max-w-2xl space-y-4 p-6`}>
        <FormAlert state={state} />
        <TempPasswordNotice password={state.tempPassword} email={state.email} />
        <div className="flex gap-2">
          <Link href={`/admin/organizations/${state.id}`} className={btnPrimary}>{t("orgs.openOrg")}</Link>
          <Link href="/admin/organizations" className={btnSecondary}>{t("common.back")}</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className={`${cardClass} max-w-2xl space-y-5 p-6`}>
      <div className="space-y-1.5">
        <label htmlFor="name" className={labelClass}>{t("orgs.fieldName")}</label>
        <input id="name" name="name" required maxLength={160} className={inputClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="type" className={labelClass}>{t("orgs.fieldType")}</label>
          <select id="type" name="type" defaultValue="LPK" className={inputClass}>
            <option value="LPK">{t("orgTypes.LPK")}</option>
            <option value="TSK">{t("orgTypes.TSK")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="country" className={labelClass}>{t("orgs.fieldCountry")}</label>
          <select id="country" name="country" defaultValue="ID" className={inputClass}>
            <option value="ID">{t("countries.ID")}</option>
            <option value="JP">{t("countries.JP")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="defaultLocale" className={labelClass}>{t("orgs.fieldDefaultLocale")}</label>
          <select id="defaultLocale" name="defaultLocale" defaultValue="id" className={inputClass}>
            <option value="id">{t("languages.id")}</option>
            <option value="ja">{t("languages.ja")}</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-4 rounded-xl border border-stone-200 p-4">
        <legend className="px-1 text-sm font-medium">{t("orgs.firstAdmin")}</legend>
        <p className="text-sm text-stone-500">{t("orgs.firstAdminNote")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="adminName" className={labelClass}>{t("orgs.adminName")}</label>
            <input id="adminName" name="adminName" required maxLength={120} className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="adminEmail" className={labelClass}>{t("orgs.adminEmail")}</label>
            <input id="adminEmail" name="adminEmail" type="email" required maxLength={254} className={inputClass} />
          </div>
        </div>
      </fieldset>

      <FormAlert state={state} />
      <div className="flex gap-2">
        <SubmitButton>{t("orgs.add")}</SubmitButton>
        <Link href="/admin/organizations" className={btnSecondary}>{t("common.cancel")}</Link>
      </div>
    </form>
  );
}
