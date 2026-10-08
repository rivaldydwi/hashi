"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { inputClass } from "@/components/styles";
import { CopyButton } from "./CopyButton";

/** Butir 14 (alasan perpanjangan): templat bawaan yang bisa diubah di halaman; perubahan TIDAK disimpan (hilang saat halaman ditutup). */
export function ReasonField({ initial }: { initial: string }) {
  const t = useTranslations("cards.renewalData");
  const [value, setValue] = useState(initial);
  return (
    <div className="space-y-2">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={1000} lang="ja" aria-label={t("reasonLabel")} className={`${inputClass} min-h-20 py-2`} data-testid="renewal-reason" />
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={value} testId="copy-reason" />
        <button type="button" className="text-xs font-medium text-accent-text underline" onClick={() => setValue(initial)}>{t("reasonReset")}</button>
        <span className="text-xs text-ink-2">{t("reasonNotSaved")}</span>
      </div>
    </div>
  );
}
