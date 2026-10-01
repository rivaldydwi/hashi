"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { cardClass, inputClass, labelClass } from "@/components/styles";
import type { Language, Role } from "@/db/schema";
import { idle, type FormState } from "@/lib/form-state";
import { updateUser } from "./actions";
import { LanguageCheckboxes } from "./LanguageCheckboxes";

export function UserEditForm({
  user,
  roles,
  orgId,
  isSelf,
}: {
  user: { id: string; name: string; email: string; role: Role; languages: Language[] };
  roles: readonly Role[];
  orgId?: string;
  isSelf: boolean;
}) {
  const t = useTranslations();
  const [state, action] = useActionState<FormState, FormData>(updateUser, idle);

  return (
    <form action={action} className={`${cardClass} space-y-4 p-6`}>
      <input type="hidden" name="userId" value={user.id} />
      {orgId && <input type="hidden" name="orgId" value={orgId} />}
      <div className="space-y-1.5">
        <label htmlFor="email" className={labelClass}>{t("users.fieldEmail")}</label>
        <input id="email" value={user.email} disabled className={inputClass} />
        <p className="text-xs text-stone-500">{t("users.emailLocked")}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="name" className={labelClass}>{t("users.fieldName")}</label>
        <input id="name" name="name" defaultValue={user.name} required maxLength={120} className={inputClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="role" className={labelClass}>{t("users.fieldRole")}</label>
          {/* Peran sendiri tidak bisa diubah; nilai tetap dikirim lewat input tersembunyi. */}
          <select id="role" name={isSelf ? undefined : "role"} defaultValue={user.role} disabled={isSelf} className={inputClass}>
            {roles.map((r) => (
              <option key={r} value={r}>{t(`roles.${r}`)}</option>
            ))}
          </select>
          {isSelf && <input type="hidden" name="role" value={user.role} />}
        </div>
      </div>
      <LanguageCheckboxes defaultValue={user.languages} />
      <FormAlert state={state} />
      <SubmitButton>{t("common.save")}</SubmitButton>
    </form>
  );
}
