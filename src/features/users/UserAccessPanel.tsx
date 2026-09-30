"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton, TempPasswordNotice } from "@/components/FormBits";
import { btnDanger, btnSecondary, cardClass } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { resetUserPassword, setUserActive } from "./actions";

export function UserAccessPanel({
  userId,
  active,
  orgId,
  isSelf,
}: {
  userId: string;
  active: boolean;
  orgId?: string;
  isSelf: boolean;
}) {
  const t = useTranslations();
  const [resetState, resetAction] = useActionState<FormState, FormData>(resetUserPassword, idle);
  const [activeState, activeAction] = useActionState<FormState, FormData>(setUserActive, idle);

  if (isSelf) return null;

  return (
    <section className={`${cardClass} space-y-5 p-6`}>
      <h2 className="font-medium">{t("users.accessTitle")}</h2>

      <form action={resetAction} className="space-y-2">
        <input type="hidden" name="userId" value={userId} />
        {orgId && <input type="hidden" name="orgId" value={orgId} />}
        <p className="text-sm text-stone-600">{t("users.resetNote")}</p>
        <SubmitButton className={btnSecondary}>{t("users.resetPassword")}</SubmitButton>
        {resetState.status === "success" && resetState.tempPassword && resetState.email ? (
          <TempPasswordNotice password={resetState.tempPassword} email={resetState.email} />
        ) : (
          <FormAlert state={resetState} />
        )}
      </form>

      <hr className="border-stone-200" />

      <form action={activeAction} className="space-y-2">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
        {orgId && <input type="hidden" name="orgId" value={orgId} />}
        <p className="text-sm text-stone-600">{t("users.deactivateNote")}</p>
        <SubmitButton className={active ? btnDanger : btnSecondary}>
          {active ? t("users.deactivate") : t("users.reactivate")}
        </SubmitButton>
        <FormAlert state={activeState} />
      </form>
    </section>
  );
}
