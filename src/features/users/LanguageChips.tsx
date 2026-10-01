import { getTranslations } from "next-intl/server";
import type { Language } from "@/db/schema";
import { normalizeLanguages } from "@/lib/languages";

/** Bahasa yang dikuasai sebagai chip. Label mengikuti bahasa tampilan; himpunan dan urutannya tidak. */
export async function LanguageChips({ languages }: { languages: readonly Language[] }) {
  const t = await getTranslations("userLanguages");
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="user-languages">
      {normalizeLanguages(languages).map((l) => (
        <span key={l} data-lang={l} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
          {t(l)}
        </span>
      ))}
    </span>
  );
}
