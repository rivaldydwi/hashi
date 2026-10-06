import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { btnPrimary, btnSecondary } from "@/components/styles";
import { requireStaff } from "@/features/records/access";
import { RECORD_PAGE_SIZE, allWorkers, listCases, listRecords, listStaff, parseRecordFilters } from "@/features/records/queries";
import { RecordFilters } from "@/features/records/ui/RecordFilters";
import { RecordList } from "@/features/records/ui/RecordList";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | string[] | undefined>>;

/** Tab 2: Notulen dan catatan pertemuan (議事録・面談記録 / Gijiroku / Mendan Kiroku). */
export default async function MeetingRecordsPage({ searchParams }: { searchParams: SP }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  const sp = await searchParams;
  const f = parseRecordFilters(sp, "meeting");
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const data = await tenantQuery(async (tx) => ({
    list: await listRecords(tx, f, me.id),
    staff: await listStaff(tx),
    workers: await allWorkers(tx),
    cases: await listCases(tx, { status: "", workerId: "" }),
  }));
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
        <Link href="/records/new?kind=meeting" className={btnPrimary} data-testid="add-daily">+ {t("meetings.add")}</Link>
      </div>

      <RecordFilters f={f} base="/records/meetings" staff={data.staff} workers={data.workers.map((w) => ({ id: w.id, name: w.fullName }))} cases={data.cases.map((c) => ({ id: c.id, label: `${c.code} ${c.title}` }))} />
      <p className="mb-2 text-sm text-ink-2"><span className="font-medium tabular-nums text-ink" data-testid="records-total">{data.list.total}</span> {t("list.totalSuffix")}</p>
      <RecordList base="/records/meetings" rows={data.list.rows} tz={tz} filtered={active} emptyAction={{ href: "/records/new?kind=meeting", label: `+ ${t("meetings.add")}` }} />
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
