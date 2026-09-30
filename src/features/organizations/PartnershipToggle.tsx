"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/FormBits";
import { btnDanger, btnSecondary } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { setPartnershipActive } from "./actions";

export function PartnershipToggle({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations("partnerships");
  const [, action] = useActionState<FormState, FormData>(setPartnershipActive, idle);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <SubmitButton className={`${active ? btnDanger : btnSecondary} !px-3 !py-1`}>
        {active ? t("deactivate") : t("activate")}
      </SubmitButton>
    </form>
  );
}
