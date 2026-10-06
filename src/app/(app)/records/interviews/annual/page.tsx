import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { btnSecondary, cardClass } from "@/components/styles";
import { FISCAL_QUARTERS, fiscalQuarterRange, fiscalTitle, fiscalYearOf } from "@/db/records-core";
import { requireStaff } from "@/features/records/access";
import { quartersOfFiscalYear } from "@/features/records/queries";
import { Badge } from "@/features/records/ui/common";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Daftar persiapan laporan tahunan ke imigrasi (T-008): per tahun fiskal (April-Maret), SEMUA pekerja yang bekerja minimal satu hari di tahun itu
 * (termasuk yang berhenti di tengah tahun), jumlah wawancara per kuartal, dan kuartal yang bolong. Formulir laporan imigrasinya sendiri belum dibuat (T-009).
 */
export default async function AnnualInterviewListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  await getLocale();
  const sp = await searchParams;
  const raw = Number.parseInt((Array.isArray(sp.fy) ? sp.fy[0] : sp.fy) ?? "", 10);
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const fy = Number.isInteger(raw) && raw >= 2020 && raw <= 2100 ? raw : fiscalYearOf(today);
  const data = await tenantQuery((tx) => quartersOfFiscalYear(tx, fy, today));
  const gaps = data.reduce((n, x) => n + x.quarters.filter((c) => c.state === "pending").length, 0);
  const complete = data.filter((x) => x.quarters.every((c) => c.state !== "pending")).length;
  const th = "border border-line bg-page px-2 py-2 text-left text-xs font-semibold text-ink-2";
  const td = "border border-line px-2 py-2 align-top text-sm";
  const link = (y: number) => `/records/interviews/annual?fy=${y}`;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={link(fy - 1)} className={btnSecondary} data-testid="annual-prev">← {fiscalTitle(fy - 1)}</Link>
        <h2 className="px-2 text-[17px] font-semibold" data-testid="annual-title">{t("annual.title")} {fiscalTitle(fy)}</h2>
        <Link href={link(fy + 1)} className={btnSecondary}>{fiscalTitle(fy + 1)} →</Link>
        <Link href={`/records/interviews?fy=${fy}`} className={`${btnSecondary} ml-auto`} data-testid="annual-back">{t("annual.backToGrid")}</Link>
      </div>
      <p className="mb-3 text-sm text-ink-2">{t("annual.intro")}</p>
      <p className="mb-3 text-sm" data-testid="annual-summary">{t("annual.summary", { workers: data.length, complete, gaps })}</p>
      {data.length === 0 ? (
        <EmptyState testId="annual-empty" title={t("annual.emptyTitle")} body={t("annual.emptyBody")} />
      ) : (
        <div className={`${cardClass} relative overflow-x-auto`}>
          <table className="w-full min-w-[44rem] border-collapse text-left" data-testid="annual-table">
            <thead><tr>
              <th className={`${th} sticky left-0 bg-page`}>{t("interviews.col.name")}</th>
              <th className={th}>{t("annual.col.period")}</th>
              {FISCAL_QUARTERS.map((q) => <th key={q} className={th}>{t("annual.col.quarter", { q })}<div className="font-normal">{fiscalQuarterRange(fy, q).start.slice(0, 7).replace("-", "/")} – {fiscalQuarterRange(fy, q).end.slice(0, 7).replace("-", "/")}</div></th>)}
              <th className={th}>{t("annual.col.gaps")}</th>
            </tr></thead>
            <tbody>
              {data.map(({ worker: w, quarters }) => {
                const missing = quarters.filter((c) => c.state === "pending").map((c) => c.q);
                return (
                  <tr key={w.id} data-testid="annual-row" data-worker={w.id} data-status={w.status} data-gaps={missing.join(",")}>
                    <th scope="row" className={`${td} sticky left-0 bg-card font-medium`}>
                      <Link href={`/candidates/${w.id}`} className="text-accent-text hover:underline">{w.fullName}</Link>
                      <div className="text-xs font-normal text-ink-2">{w.companyName}</div>
                      <Link href={`/records/workers/${w.id}`} className="inline-flex min-h-11 items-center text-xs font-normal text-ink-2 underline hover:text-accent-text">{t("whistory.historyLink")}</Link>
                    </th>
                    <td className={`${td} whitespace-nowrap`}>
                      {w.spans.map((s) => `${s.start.replace(/-/g, "/")} – ${s.end ? s.end.replace(/-/g, "/") : t("annual.ongoing")}`).reverse().map((x, i) => <div key={i}>{x}</div>)}
                      {w.status === "ENDED" && w.endDate && <Badge tone="neutral" testId="annual-ended">{t("interviews.endedOn", { date: w.endDate.replace(/-/g, "/") })}</Badge>}
                    </td>
                    {quarters.map((c) => (
                      <td key={c.q} className={td} data-testid="annual-quarter" data-quarter={c.q} data-state={c.state} data-count={c.count}>
                        {c.state === "notRequired" || c.state === "notDue" ? <span className="text-ink-2">—</span> : (
                          <span className="font-medium">{c.state === "done" ? "✅" : c.state === "pending" ? "🔴" : "➖"} {t(`interviews.qstate.${c.state}`)}
                            {c.state === "done" && <span className="font-normal text-ink-2"> ({t("interviews.countInQuarter", { n: c.count })})</span>}</span>
                        )}
                      </td>
                    ))}
                    <td className={td} data-testid="annual-gaps">{missing.length === 0 ? <span className="text-ink-2">—</span> : <Badge tone="danger">{missing.map((q) => t("annual.col.quarter", { q })).join(", ")}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
