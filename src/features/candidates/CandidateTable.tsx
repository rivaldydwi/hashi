import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DecisionBadge } from "@/components/DecisionBadge";
import { StageBadge } from "@/components/StageBadge";
import { cardClass, tableHeadClass } from "@/components/styles";
import { formatAvg } from "@/features/assessments/fields";
import type { Stats } from "@/features/assessments/queries";
import type { CandidateListRow } from "./queries";

export async function CandidateTable({ rows, isTsk, stats }: { rows: CandidateListRow[]; isTsk: boolean; stats: Map<string, Stats> }) {
  const t = await getTranslations("candidates");

  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="candidate-table">
          <thead className={tableHeadClass}>
            <tr>
              <th className="px-5 py-2 font-medium">{t("colName")}</th>
              {isTsk && <th className="px-5 py-2 font-medium">{t("colLpk")}</th>}
              <th className="px-5 py-2 font-medium">{t("colField")}</th>
              <th className="px-5 py-2 font-medium">{t("colStage")}</th>
              <th className="px-5 py-2 font-medium">{t("colLatest")}</th>
              {!isTsk && <th className="px-5 py-2 font-medium">{t("colShared")}</th>}
              {isTsk && <th className="px-5 py-2 font-medium">{t("colDecision")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((c) => (
              <tr key={c.id} data-testid="candidate-row">
                <td className="px-5 py-3">
                  <Link href={`/candidates/${c.id}`} className="font-medium text-brand-700 hover:underline">
                    {c.fullName}
                  </Link>
                  {c.nameKatakana && <div className="text-xs text-stone-500">{c.nameKatakana}</div>}
                </td>
                {isTsk && <td className="px-5 py-3 text-stone-700">{c.lpkName}</td>}
                <td className="px-5 py-3 text-stone-700">{c.field ?? "—"}</td>
                <td className="px-5 py-3"><StageBadge stage={c.stage} /></td>
                <td className="px-5 py-3 tabular-nums" data-testid="latest-avg">
                  {stats.get(c.id) ? formatAvg(stats.get(c.id)!.latestAvg) : "—"}
                </td>
                {!isTsk && (
                  <td className="px-5 py-3 text-xs" data-testid="shared-cell">
                    <span className={`rounded-full px-2.5 py-0.5 font-medium ${c.sharedWithTsk ? "bg-sky-50 text-sky-800" : "bg-stone-100 text-stone-600"}`}>
                      {c.sharedWithTsk ? t("shared") : t("notShared")}
                    </span>
                  </td>
                )}
                {isTsk && <td className="px-5 py-3"><DecisionBadge decision={c.decision} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
