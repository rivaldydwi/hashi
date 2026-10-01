"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { btnDanger, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { createSkillField, deleteSkillField, setSkillFieldActive, updateSkillField } from "./actions";

export function SkillFieldCreateForm() {
  const [state, action] = useActionState<FormState, FormData>(createSkillField, idle);
  const t = useTranslations("skillFields");
  return (
    <form action={action} key={state.status === "success" ? "done" : "new"} className={`${cardClass} mb-4 grid gap-3 p-4 sm:grid-cols-4`} data-testid="form-skill-field-create">
      <div className="space-y-1.5">
        <label htmlFor="sf-code" className={labelClass}>{t("code")}</label>
        <input id="sf-code" name="code" required maxLength={40} pattern="[a-z0-9][a-z0-9\-]*" placeholder="logistics" className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="sf-name-id" className={labelClass}>{t("nameId")}</label>
        <input id="sf-name-id" name="nameId" required maxLength={120} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="sf-name-ja" className={labelClass}>{t("nameJa")}</label>
        <input id="sf-name-ja" name="nameJa" required maxLength={120} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="sf-sort" className={labelClass}>{t("sortOrder")}</label>
        <input id="sf-sort" name="sortOrder" type="number" min={0} defaultValue={100} className={inputClass} />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
        <SubmitButton>{t("add")}</SubmitButton>
        <FormAlert state={state} />
      </div>
    </form>
  );
}

export function SkillFieldRowForms({ id, nameId, nameJa, sortOrder, active, used }: { id: string; nameId: string; nameJa: string; sortOrder: number; active: boolean; used: number }) {
  const [saveState, save] = useActionState<FormState, FormData>(updateSkillField, idle);
  const [toggleState, toggle] = useActionState<FormState, FormData>(setSkillFieldActive, idle);
  const [delState, del] = useActionState<FormState, FormData>(deleteSkillField, idle);
  const t = useTranslations("skillFields");
  return (
    <div className="space-y-2">
      <form action={save} className="flex flex-wrap items-end gap-2" data-testid="form-skill-field-edit">
        <input type="hidden" name="id" value={id} />
        <input name="nameId" defaultValue={nameId} required maxLength={120} aria-label={t("nameId")} className={`${inputClass} w-56`} />
        <input name="nameJa" defaultValue={nameJa} required maxLength={120} aria-label={t("nameJa")} className={`${inputClass} w-44`} />
        <input name="sortOrder" type="number" min={0} defaultValue={sortOrder} aria-label={t("sortOrder")} className={`${inputClass} w-20`} />
        <SubmitButton className={btnSecondary}>{t("save")}</SubmitButton>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <form action={toggle}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <SubmitButton className={btnSecondary}>{active ? t("deactivate") : t("activate")}</SubmitButton>
        </form>
        <form action={del}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton className={btnDanger}>{t("delete")}</SubmitButton>
        </form>
        {used > 0 && <span className="text-xs text-stone-500">{t("usedHint", { n: used })}</span>}
      </div>
      <FormAlert state={saveState.status !== "idle" ? saveState : toggleState.status !== "idle" ? toggleState : delState} />
    </div>
  );
}
