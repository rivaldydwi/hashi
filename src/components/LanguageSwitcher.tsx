"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/lib/actions";

const OPTIONS = [
  { value: "id", label: "Indonesia" },
  { value: "ja", label: "日本語" },
] as const;

export function LanguageSwitcher() {
  const current = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="group" aria-label={t("language")} className="inline-flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
      {OPTIONS.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={pending || active}
            aria-pressed={active}
            onClick={() =>
              startTransition(async () => {
                await setLocale(opt.value);
                router.refresh();
              })
            }
            className={`rounded-md px-3 py-1 transition ${
              active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
            } disabled:cursor-default`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
