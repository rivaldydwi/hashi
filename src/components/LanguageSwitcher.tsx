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
    <div role="group" aria-label={t("language")} className="flex rounded-xl border border-line-btn bg-card p-0.5 text-sm">
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
            className={`min-h-11 flex-1 rounded-[10px] px-3 font-medium transition ${
              active ? "bg-accent-soft text-accent-text" : "text-ink-menu hover:bg-hover"
            } disabled:cursor-default`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
