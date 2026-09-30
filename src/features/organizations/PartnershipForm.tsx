"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { cardClass, inputClass, labelClass } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { createPartnership } from "./actions";

type Option = { id: string; name: string };

export function PartnershipForm({ lpks, tsks }: { lpks: Option[]; tsks: Option[] }) {
  const t = useTranslations("partnerships");
  const [state, action] = useActionState<FormState, FormData>(createPartnership, idle);

  return (
    <form action={action} className={`${cardClass} space-y-4 p-6`}>
      <h2 className="font-medium">{t("add")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="lpkId" className={labelClass}>{t("fieldLpk")}</label>
          <select id="lpkId" name="lpkId" required defaultValue="" className={inputClass}>
            <option value="" disabled>{t("choose")}</option>
            {lpks.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="tskId" className={labelClass}>{t("fieldTsk")}</label>
          <select id="tskId" name="tskId" required defaultValue="" className={inputClass}>
            <option value="" disabled>{t("choose")}</option>
            {tsks.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>
      <FormAlert state={state} />
      <SubmitButton>{t("add")}</SubmitButton>
    </form>
  );
}
