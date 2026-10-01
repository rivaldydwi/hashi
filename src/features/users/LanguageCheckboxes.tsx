"use client";

import { useTranslations } from "next-intl";
import { labelClass } from "@/components/styles";
import type { Language } from "@/db/schema";
import { LANGUAGE_ORDER } from "@/lib/languages";

/** Kotak centang bahasa yang dikuasai (minimal satu; divalidasi server, pesan dari users.errors.languagesRequired). */
export function LanguageCheckboxes({ defaultValue }: { defaultValue: readonly Language[] }) {
  const t = useTranslations();
  return (
    <fieldset className="space-y-1.5" data-testid="language-checkboxes">
      <legend className={labelClass}>{t("users.fieldLanguages")}</legend>
      <div className="flex flex-wrap gap-4">
        {LANGUAGE_ORDER.map((l) => (
          <label key={l} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="languages" value={l} id={`languages-${l}`} defaultChecked={defaultValue.includes(l)} />
            {t(`userLanguages.${l}`)}
          </label>
        ))}
      </div>
      <p className="text-xs text-stone-500">{t("users.languagesHint")}</p>
    </fieldset>
  );
}
