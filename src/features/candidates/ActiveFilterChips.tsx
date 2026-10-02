import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { CandidateFilters } from "./queries";

type Chip = { key: keyof CandidateFilters; text: string; testId?: string };

/** Filter yang sedang aktif sebagai chip; tiap chip punya tombol hapus (tautan yang melepas SATU filter dan mempertahankan sisanya). */
export async function ActiveFilterChips({ filters, fieldLabel }: { filters: CandidateFilters; fieldLabel: (code: string) => string }) {
  const t = await getTranslations("candidates");
  const tStage = await getTranslations("stages");
  const tDec = await getTranslations("decisions");
  const chips: Chip[] = [];
  if (filters.view) chips.push({ key: "view", text: t(`viewLabel.${filters.view}` as never), testId: "view-chip" });
  if (filters.q) chips.push({ key: "q", text: t("chipQ", { q: filters.q }) });
  if (filters.stage) chips.push({ key: "stage", text: t("chipStage", { v: tStage(filters.stage) }) });
  if (filters.field) chips.push({ key: "field", text: t("chipField", { v: fieldLabel(filters.field) }) });
  if (filters.decision) chips.push({ key: "decision", text: t("chipDecision", { v: tDec(filters.decision) }) });
  if (filters.avg) chips.push({ key: "avg", text: t("chipAvg", { v: filters.avg }) });
  if (filters.attendance) chips.push({ key: "attendance", text: t("chipAttendance", { v: filters.attendance }) });
  if (filters.jlpt) chips.push({ key: "jlpt", text: t("chipJlpt", { v: filters.jlpt }) });
  if (chips.length === 0) return null;

  const base: Record<string, string> = { q: filters.q, stage: filters.stage, field: filters.field, decision: filters.decision, avg: filters.avg, attendance: filters.attendance, jlpt: filters.jlpt, view: filters.view };
  const without = (k: string) => {
    const p = new URLSearchParams();
    for (const [key, v] of Object.entries(base)) if (v && key !== k) p.set(key, v);
    const qs = p.toString();
    return qs ? `/candidates?${qs}` : "/candidates";
  };

  return (
    <ul className="mb-3 flex flex-wrap items-center gap-2" aria-label={t("activeFilters")} data-testid="filter-chips">
      {chips.map((c) => (
        <li key={c.key} data-testid={c.testId ?? "filter-chip"} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">
          {c.text}
          <Link href={without(c.key)} aria-label={t("removeFilter", { name: c.text })} data-testid="filter-chip-remove" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </Link>
        </li>
      ))}
      {chips.length > 1 && <li><Link href="/candidates" className="inline-flex min-h-11 items-center px-2 text-sm text-ink-2 underline hover:text-ink" data-testid="filter-clear-all">{t("clearAll")}</Link></li>}
    </ul>
  );
}
