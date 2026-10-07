import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DecisionBadge } from "@/components/DecisionBadge";
import { StageBadge } from "@/components/StageBadge";
import { cardClass, tableHeadClass } from "@/components/styles";
import { formatAvg } from "@/features/assessments/fields";
import type { Stats } from "@/features/assessments/queries";
import type { CandidateListRow } from "./queries";

// Tabel di layar lebar; di ponsel (< md) tiap baris menjadi kartu: kolom jadi pasangan label-nilai (label dari data-label, tanpa duplikasi DOM).
const cell = "cjk-phrase flex items-center justify-between gap-3 py-1 before:text-xs before:text-ink-2 before:content-[attr(data-label)] md:table-cell md:px-5 md:py-3 md:before:content-none";

export async function CandidateTable({ rows, isTsk, stats }: { rows: CandidateListRow[]; isTsk: boolean; stats: Map<string, Stats> }) {
  const t = await getTranslations("candidates");
  const locale = await getLocale();

  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="block w-full text-left text-sm md:table" data-testid="candidate-table">
          <thead className={`${tableHeadClass} max-md:sr-only`}>
            <tr>
              <th className="px-5 py-2 font-medium max-md:block">{t("colName")}</th>
              {isTsk && <th className="px-5 py-2 font-medium max-md:block">{t("colLpk")}</th>}
              <th className="px-5 py-2 font-medium max-md:block">{t("colField")}</th>
              <th className="px-5 py-2 font-medium max-md:block">{t("colStage")}</th>
              <th className="px-5 py-2 font-medium max-md:block">{t("colLatest")}</th>
              {!isTsk && <th className="px-5 py-2 font-medium max-md:block">{t("colShared")}</th>}
              {isTsk && <th className="px-5 py-2 font-medium max-md:block">{t("colDecision")}</th>}
            </tr>
          </thead>
          <tbody className="block divide-y divide-line md:table-row-group">
            {rows.map((c) => (
              <tr key={c.id} data-testid="candidate-row" className="block max-md:px-4 max-md:py-3 md:table-row">
                <td translate="no" className="block cjk-phrase md:table-cell md:min-w-40 md:px-5 md:py-3">
                  <Link href={`/candidates/${c.id}`} className="inline-flex min-h-11 items-center font-medium text-accent-text hover:underline md:min-h-0">
                    {c.fullName}
                  </Link>
                  {c.nameKatakana && <div lang="ja" className="text-xs text-ink-2">{c.nameKatakana}</div>}
                </td>
                {isTsk && <td translate="no" data-label={t("colLpk")} className={`${cell} text-ink-menu md:min-w-44`}>{c.lpkName}</td>}
                <td data-label={t("colField")} className={`${cell} text-ink-menu`}>{(locale === "ja" ? c.fieldNameJa : c.fieldNameId) ?? "—"}</td>
                <td data-label={t("colStage")} className={cell}><StageBadge stage={c.stage} /></td>
                <td data-label={t("colLatest")} className={`${cell} tabular-nums`} data-testid="latest-avg">
                  {stats.get(c.id) ? formatAvg(stats.get(c.id)!.latestAvg) : "—"}
                </td>
                {!isTsk && (
                  <td data-label={t("colShared")} className={`${cell} text-xs`} data-testid="shared-cell">
                    <span className={`rounded-full px-2.5 py-0.5 font-medium ${c.sharedWithTsk ? "bg-sky-50 text-sky-900" : "bg-stone-100 text-stone-800"}`}>
                      {c.sharedWithTsk ? t("shared") : t("notShared")}
                    </span>
                  </td>
                )}
                {isTsk && <td data-label={t("colDecision")} className={cell}><DecisionBadge decision={c.decision} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
