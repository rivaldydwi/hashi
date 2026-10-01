"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton, TempPasswordNotice } from "@/components/FormBits";
import { btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import type { Role } from "@/db/schema";
import { idle, type FormState } from "@/lib/form-state";
import { createUser } from "./actions";
import { LanguageCheckboxes } from "./LanguageCheckboxes";

export function UserCreateForm({
  roles,
  orgId,
  backHref,
}: {
  roles: readonly Role[];
  orgId?: string;
  backHref: string;
}) {
  const t = useTranslations();
  const [state, action] = useActionState<FormState, FormData>(createUser, idle);

  if (state.status === "success" && state.tempPassword && state.email) {
    return (
      <div className={`${cardClass} max-w-xl space-y-4 p-6`}>
        <FormAlert state={state} />
        <TempPasswordNotice password={state.tempPassword} email={state.email} />
        <div className="flex gap-2">
          <Link href={backHref} className={btnSecondary}>
            {t("users.backToList")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className={`${cardClass} max-w-xl space-y-4 p-6`}>
      {orgId && <input type="hidden" name="orgId" value={orgId} />}
      <div className="space-y-1.5">
        <label htmlFor="name" className={labelClass}>{t("users.fieldName")}</label>
        <input id="name" name="name" required maxLength={120} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className={labelClass}>{t("users.fieldEmail")}</label>
        <input id="email" name="email" type="email" required maxLength={254} className={inputClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="role" className={labelClass}>{t("users.fieldRole")}</label>
          <select id="role" name="role" defaultValue={roles.at(-1)} className={inputClass}>
            {roles.map((r) => (
              <option key={r} value={r}>{t(`roles.${r}`)}</option>
            ))}
          </select>
        </div>
      </div>
      <LanguageCheckboxes defaultValue={["id"]} />
      <FormAlert state={state} />
      <div className="flex gap-2">
        <SubmitButton>{t("users.add")}</SubmitButton>
        <Link href={backHref} className={btnSecondary}>{t("common.cancel")}</Link>
      </div>
    </form>
  );
}
