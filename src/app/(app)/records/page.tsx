import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { btnPrimary, btnSecondary } from "@/components/styles";
import { unreadReportIds } from "@/db/records-queries";
import { requireStaff } from "@/features/records/access";
import { RECORD_PAGE_SIZE, activeWorkers, listCases, listRecords, listStaff, myDailyReport, parseRecordFilters, reportsForMe } from "@/features/records/queries";
import { DailyReportCard } from "@/features/records/ui/DailyReportCard";
import { RecordFilters } from "@/features/records/ui/RecordFilters";
import { RecordList } from "@/features/records/ui/RecordList";
import { roleLabelMap } from "@/features/records/ui/common";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | string[] | undefined>>;

/** Tab 1: Catatan kerja harian (業務記録 / Gyōmu Kiroku), dikelompokkan per hari. */
export default async function DailyRecordsPage({ searchParams }: { searchParams: SP }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  const sp = await searchParams;
  const f = parseRecordFilters(sp, "daily_work");
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const data = await tenantQuery(async (tx) => ({
    list: await listRecords(tx, f, me.id),
    staff: await listStaff(tx),
    workers: await activeWorkers(tx),
    cases: await listCases(tx, { status: "", workerId: "" }),
    report: await myDailyReport(tx, me.id, today),
    unreadReports: (await unreadReportIds(tx, me.id)).length,
    unreadReportRows: f.unread ? await reportsForMe(tx, me.id, { unreadOnly: true }) : [],
  }));
  const roleLabels = await roleLabelMap();
  const pages = Math.max(1, Math.ceil(data.list.total / RECORD_PAGE_SIZE));
  const active = Boolean(f.from || f.to || f.staff || f.worker || f.workType || f.caseId || f.unread || f.openTasks);
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: f.unread ? "unread" : "", from: f.from, to: f.to, staff: f.staff, worker: f.worker, workType: f.workType, case: f.caseId, tasks: f.openTasks ? "open" : "" })) if (v) p.set(k, v);
    if (page > 1) p.set("page", String(page));
    return p.toString() ? `/records?${p}` : "/records";
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/records/new?kind=daily_work" className={btnPrimary} data-testid="add-daily">+ {t("daily.add")}</Link>
        <Link href="/records/reports" className={btnSecondary} data-testid="staff-reports-link">{t("report.staffReports")}{data.unreadReports > 0 ? ` (${data.unreadReports})` : ""}</Link>
        <a href={`/records/export/daily?date=${today}&staff=${me.id}`} className={btnSecondary} data-testid="export-daily-today">{t("export.dailyToday")}</a>
      </div>

      <DailyReportCard state={data.report} date={today} tz={tz} staff={data.staff} meId={me.id} roleLabels={roleLabels} />

      {f.unread && (
        <p className="mb-3 rounded-xl border border-line bg-card px-4 py-3 text-sm" data-testid="unread-summary" role="status">
          {t("daily.unreadSummary", { records: data.list.total, reports: data.unreadReportRows.length })}
          {data.unreadReportRows.length > 0 && <> <Link href="/records/reports?view=unread" className="font-semibold text-accent-text underline">{t("report.openUnread")}</Link></>}
        </p>
      )}

      <RecordFilters f={f} base="/records" staff={data.staff} workers={data.workers.map((w) => ({ id: w.id, name: w.fullName }))} cases={data.cases.map((c) => ({ id: c.id, label: `${c.code} ${c.title}` }))} />
      <p className="mb-2 text-sm text-ink-2"><span className="font-medium tabular-nums text-ink" data-testid="records-total">{data.list.total}</span> {t("list.totalSuffix")}</p>
      <RecordList rows={data.list.rows} tz={tz} filtered={active} emptyAction={{ href: "/records/new?kind=daily_work", label: `+ ${t("daily.add")}` }} />
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          {f.page > 1 ? <Link href={qs(f.page - 1)} className={btnSecondary}>← {t("list.prev")}</Link> : <span />}
          <span className="text-ink-2">{t("list.pageOf", { page: f.page, pages })}</span>
          {f.page < pages ? <Link href={qs(f.page + 1)} className={btnSecondary}>{t("list.next")} →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
