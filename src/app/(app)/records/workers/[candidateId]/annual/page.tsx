import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Data } from "@/components/Data";
import { EmptyState } from "@/components/EmptyState";
import { btnPrimary, btnSecondary, cardClass, gridTd, gridTh } from "@/components/styles";
import { FORM55_ITEM_CODES, summarizeForm55 } from "@/db/form55";
import { fiscalTitle, fiscalYearOf, quarterOfMonth } from "@/db/records-core";
import { requireStaff } from "@/features/records/access";
import { eventMeetings, isConducted, yearInterviews } from "@/features/records/form55-queries";
import { workerBasics } from "@/features/records/queries";
import { Badge, dateLabelSync } from "@/features/records/ui/common";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Halaman tahunan satu pekerja (T-009): semua 定期面談 di satu tahun fiskal (dengan status form 5-5 dan PDF-nya), PDF gabungan setahun, dan 面談 karena kejadian
 * (catatan ② yang menyebut pekerja ini; TERPISAH dari 定期面談 dan tidak memakai form 5-5). Hanya staf TSK (layout /records: peran lain 404); pekerja tak terlihat = 404.
 */
export default async function WorkerAnnualPage({ params, searchParams }: { params: Promise<{ candidateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const { candidateId } = await params;
  if (!UUID.test(candidateId)) notFound();
  const sp = await searchParams;
  const raw = Number.parseInt((Array.isArray(sp.fy) ? sp.fy[0] : sp.fy) ?? "", 10);
  const t = await getTranslations("records");
  const locale = await getLocale();
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const fy = Number.isInteger(raw) && raw >= 2020 && raw <= 2100 ? raw : fiscalYearOf(today);
  const data = await tenantQuery(async (tx) => {
    const w = await workerBasics(tx, candidateId);
    if (!w) return null;
    return { w, interviews: await yearInterviews(tx, candidateId, fy), events: await eventMeetings(tx, candidateId, fy) };
  });
  if (!data) notFound();
  const { w, interviews, events } = data;
  const conducted = interviews.filter(isConducted);
  const base = `/records/workers/${candidateId}/annual`;
  const th = gridTh;
  const td = gridTd;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${base}?fy=${fy - 1}`} className={btnSecondary} data-testid="wannual-prev">← {fiscalTitle(fy - 1)}</Link>
        <h2 className="px-2 text-[19px] font-semibold" data-testid="wannual-title">{t.rich("annual.workerTitle", { name: w.name, n: (chunks) => <Data>{chunks}</Data> })} · {fiscalTitle(fy)}</h2>
        <Link href={`${base}?fy=${fy + 1}`} className={btnSecondary}>{fiscalTitle(fy + 1)} →</Link>
        <Link href={`/records/workers/${candidateId}`} className={`${btnSecondary} ml-auto`}>{t("whistory.historyLink")}</Link>
      </div>
      <p className="text-sm text-ink-2">{t("annual.workerIntro")}</p>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="wa-periodic" data-testid="wannual-periodic">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="wa-periodic" className="text-[17px] font-semibold">{t("annual.periodicTitle")}</h3>
          {conducted.length > 0 && <a href={`/records/export/form55-year/${candidateId}?fy=${fy}`} className={btnPrimary} data-testid="wannual-pdf-all">{t("annual.pdfAll", { n: conducted.length })}</a>}
        </div>
        {interviews.length === 0 ? (
          <EmptyState testId="wannual-empty" title={t("annual.workerEmptyTitle")} body={t("annual.workerEmptyBody")} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left" data-testid="wannual-table">
              <thead><tr>
                <th className={th}>{t("annual.col.month")}</th><th className={th}>{t("interviews.form.date")}</th><th className={th}>{t("interviews.form.status")}</th>
                <th className={th}>{t("annual.col.form")}</th><th className={th}>{t("annual.col.pdf")}</th>
              </tr></thead>
              <tbody>
                {interviews.map((r) => {
                  const sum = summarizeForm55(r.form);
                  const done = isConducted(r);
                  return (
                    <tr key={r.id} data-testid="wannual-row" data-month={r.month.slice(0, 7)} data-quarter={quarterOfMonth(r.month)} data-form={sum.filled ? (sum.nonconformity ? "nonconformity" : "filled") : "empty"}>
                      <td className={td}><Link href={`/records/interviews/${candidateId}/${r.month}`} className="text-accent-text hover:underline">{r.month.slice(0, 4)}/{r.month.slice(5, 7)}</Link> <span className="text-xs text-ink-2">Q{quarterOfMonth(r.month)}</span></td>
                      <td className={td}>{r.interviewDate ? r.interviewDate.replace(/-/g, "/") : "—"}</td>
                      <td className={td}>{r.applicable ? (r.resultStatus ? t(`results.${r.resultStatus}`) : "—") : t("interviews.state.na")}</td>
                      <td className={td}>
                        {!done ? <span className="text-ink-2">—</span> : sum.filled ? (
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <Badge tone="neutral">{t("annual.formAnswered", { n: sum.answered, total: FORM55_ITEM_CODES.length })}</Badge>
                            {sum.problems > 0 && <Badge tone="warn">{t("annual.formProblems", { n: sum.problems })}</Badge>}
                            {sum.nonconformity && <Badge tone="danger">{t("form55.stateNonconformity")}</Badge>}
                          </span>
                        ) : <Badge tone="neutral">{t("form55.notFilled")}</Badge>}
                      </td>
                      <td className={td}>{done ? <a href={`/records/export/form55/${candidateId}/${r.month}`} className="inline-flex min-h-11 items-center text-accent-text underline" data-testid="wannual-pdf">{t("annual.pdfOne")}</a> : <span className="text-ink-2">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="wa-events" data-testid="wannual-events">
        <h3 id="wa-events" className="text-[17px] font-semibold">{t("annual.eventTitle")}</h3>
        <p className="mb-3 text-sm text-ink-2">{t("annual.eventHint")}</p>
        {events.length === 0 ? <p className="text-sm text-ink-2" data-testid="wannual-events-empty">{t("annual.eventEmpty")}</p> : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-sm" data-testid="wannual-event">
                <Badge tone="neutral">{t("annual.eventBadge")}</Badge>
                <span>{dateLabelSync(e.recordDate, locale)}</span>
                <Link href={`/records/${e.id}`} className="text-accent-text hover:underline">{e.subject ? <Data>{e.subject}</Data> : t("annual.eventNoSubject")}</Link>
                <Data className="text-xs text-ink-2">{e.authorName}</Data>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
