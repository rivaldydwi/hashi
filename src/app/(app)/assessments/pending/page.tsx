import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { btnPrimary, cardClass } from "@/components/styles";
import { currentPeriod } from "@/db/time";
import { assessmentStats, pendingCandidates } from "@/features/assessments/queries";
import { formatAvg } from "@/features/assessments/fields";
import { requireUser, tenantQuery } from "@/lib/session";

export const metadata: Metadata = { title: "Pending assessments" };

/** Kandidat LPK (Belajar / Siap seleksi) yang belum dinilai bulan ini. "Bulan ini" = APP_TIMEZONE (src/db/time.ts). */
export default async function PendingAssessmentsPage() {
  const me = await requireUser();
  if (me.role !== "LPK_ADMIN" && me.role !== "LPK_SENSEI") redirect("/");
  const t = await getTranslations("assessments");
  const format = await getFormatter();
  const locale = await getLocale();
  const period = currentPeriod();
  const monthLabel = (p: string) => format.dateTime(new Date(`${p}T00:00:00Z`), { month: "long", year: "numeric", timeZone: "UTC" });

  const { rows, stats } = await tenantQuery(async (tx) => ({ rows: await pendingCandidates(tx, period), stats: await assessmentStats(tx) }));

  return (
    <>
      <PageHeader title={t("pendingTitle")} intro={t("pendingIntro", { month: monthLabel(period) })} />
      <p className="mb-3 text-sm text-stone-500">
        <span className="font-medium tabular-nums text-stone-800" data-testid="pending-total">{rows.length}</span> {t("pendingSuffix")}
      </p>
      {rows.length === 0 ? (
        <div className={`${cardClass} p-8 text-center text-sm text-stone-500`} data-testid="pending-empty">{t("pendingEmpty")}</div>
      ) : (
        <ul className={`${cardClass} divide-y divide-stone-100`} data-testid="pending-list">
          {rows.map((c) => {
            const s = stats.get(c.id);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="pending-row">
                <div className="min-w-0">
                  <Link href={`/candidates/${c.id}#penilaian`} className="font-medium text-brand-700 hover:underline">{c.fullName}</Link>
                  {c.nameKatakana && <span className="ml-2 text-xs text-stone-500">{c.nameKatakana}</span>}
                  <p className="mt-0.5 text-xs text-stone-500">
                    {(locale === "ja" ? c.fieldNameJa : c.fieldNameId) ?? "—"} · {s ? t("lastAssessed", { month: monthLabel(s.latestPeriod), avg: formatAvg(s.latestAvg) }) : t("neverAssessed")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StageBadge stage={c.stage} />
                  <Link href={`/candidates/${c.id}#penilaian`} className={`${btnPrimary} !px-3 !py-1.5`}>{t("assessNow")}</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
