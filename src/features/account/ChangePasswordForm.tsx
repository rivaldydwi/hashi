"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { inputClass, labelClass } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const t = useTranslations("account");
  const [state, action] = useActionState<FormState, FormData>(changePassword, idle);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="currentPassword" className={labelClass}>{t("currentPassword")}</label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="newPassword" className={labelClass}>{t("newPassword")}</label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
        <p className="text-xs text-stone-500">{t("passwordHint")}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className={labelClass}>{t("confirmPassword")}</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </div>
      <FormAlert state={state} />
      <SubmitButton>{t("submit")}</SubmitButton>
    </form>
  );
}
