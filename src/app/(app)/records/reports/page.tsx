import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { btnSecondary, cardClass } from "@/components/styles";
import { requireStaff } from "@/features/records/access";
import { markReportRead } from "@/features/records/actions";
import { reportsForMe } from "@/features/records/queries";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { Badge, dateLabelSync } from "@/features/records/ui/common";
import { dateTimeIn, safeTimezone } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Laporan harian staf yang dikirim KEPADAKU (leader): per tanggal, per staf, dengan tombol "Tandai sudah dibaca". */
export default async function StaffReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  const unreadOnly = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "unread";
  const t = await getTranslations("records");
  const locale = await getLocale();
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const rows = await tenantQuery((tx) => reportsForMe(tx, me.id, { unreadOnly }));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-[19px] font-semibold">{t("report.staffReports")}</h2>
        <Link href={unreadOnly ? "/records/reports" : "/records/reports?view=unread"} className={btnSecondary} data-testid="reports-toggle">{unreadOnly ? t("report.showAll") : t("report.showUnread")}</Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState testId="reports-empty" title={t("report.emptyTitle")} body={t("report.emptyBody")} />
      ) : (
        <ul className={`${cardClass} divide-y divide-line`} data-testid="staff-reports">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="staff-report" data-author={r.authorId} data-date={r.reportDate}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{dateLabelSync(r.reportDate, locale)} · {r.authorName}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                  <span>{t("report.count", { n: r.count })}</span>
                  <span>{t("report.sentAt", { time: dateTimeIn(r.sharedAt, locale, tz) })}</span>
                  {r.readAt === null && <Badge tone="accent" testId="report-unread">{t("badge.unread")}</Badge>}
                  {r.readAt !== null && !r.updatedSinceRead && <Badge tone="ok">{t("report.readAt", { time: dateTimeIn(r.readAt, locale, tz) })}</Badge>}
                  {r.updatedSinceRead && <Badge tone="warn" testId="report-updated">{t("badge.updatedSinceRead")}</Badge>}
                  {r.addedAfter > 0 && <Badge tone="warn" testId="report-added-after">{t("report.addedAfter", { n: r.addedAfter })}</Badge>}
                  {r.editedAfter > 0 && <Badge tone="warn" testId="report-edited-after">{t("report.editedAfter", { n: r.editedAfter })}</Badge>}
                </p>
              </div>
              <Link href={`/records?staff=${r.authorId}&from=${r.reportDate}&to=${r.reportDate}`} className={btnSecondary} data-testid="open-report-records">{t("report.openRecords")}</Link>
              <a href={`/records/export/daily?date=${r.reportDate}&staff=${r.authorId}`} className={btnSecondary}>{t("export.daily")}</a>
              {(r.readAt === null || r.updatedSinceRead) && <ActionForm action={markReportRead} hidden={{ id: r.id }} submitLabel={t("report.markRead")} testId="mark-report-read" />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
