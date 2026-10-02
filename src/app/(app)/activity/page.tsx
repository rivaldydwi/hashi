import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { AUDIT_CATEGORIES } from "@/db/audit-describe";
import { AUDIT_PAGE_SIZE, listAudit, parseAuditFilters } from "@/db/audit-history";
import { AuditList } from "@/features/audit/AuditList";
import { safeTimezone } from "@/lib/org-time";
import { requireUser, tenantQuery } from "@/lib/session";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Riwayat aktivitas organisasi. Hanya LPK_ADMIN dan TSK_ADMIN (RLS juga menolak peran lain); selain itu 404. */
export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireUser();
  if (me.role !== "LPK_ADMIN" && me.role !== "TSK_ADMIN") notFound();
  const t = await getTranslations("activity");
  const f = parseAuditFilters(await searchParams);
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const { rows, total } = await tenantQuery((tx) => listAudit(tx, f, tz));
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const active = Boolean(f.category || f.from || f.to || f.candidateId);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ category: f.category, from: f.from, to: f.to, candidate: f.candidateId, ...over })) if (v) p.set(k, v);
    return p.toString();
  };
  const exportHref = `/activity/export${qs({}) ? `?${qs({})}` : ""}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro", { tz })}
        action={<a href={exportHref} className={btnSecondary} data-testid="audit-export" download>{t("export")}</a>}
      />
      <form method="get" action="/activity" className={`${cardClass} mb-4 grid gap-3 p-4 sm:grid-cols-4`} data-testid="audit-filters">
        {f.candidateId && <input type="hidden" name="candidate" value={f.candidateId} />}
        <div className="space-y-1.5">
          <label htmlFor="category" className={labelClass}>{t("filterCategory")}</label>
          <select id="category" name="category" defaultValue={f.category} className={inputClass}>
            <option value="">{t("all")}</option>
            {AUDIT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="from" className={labelClass}>{t("from")}</label>
          <input id="from" name="from" type="date" defaultValue={f.from} className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="to" className={labelClass}>{t("to")}</label>
          <input id="to" name="to" type="date" defaultValue={f.to} className={inputClass} />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnPrimary}>{t("apply")}</button>
          {active && <Link href="/activity" className={btnSecondary}>{t("reset")}</Link>}
        </div>
      </form>

      <p className="mb-2 text-sm text-ink-2"><span className="font-medium tabular-nums text-ink" data-testid="audit-total">{total}</span> {t("totalSuffix")}</p>

      {rows.length === 0 ? (
        <EmptyState testId="audit-empty" title={active ? t("noMatchTitle") : t("emptyTitle")} body={active ? t("noMatchBody") : t("emptyBody")} action={active ? { href: "/activity", label: t("reset") } : undefined} />
      ) : (
        <div className={`${cardClass} px-4 sm:px-5`}>
          <AuditList rows={rows} timezone={tz} emptyText={t("emptyTitle")} />
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          {f.page > 1 ? <Link href={`/activity?${qs({ page: String(f.page - 1) })}`} className={btnSecondary}>← {t("prev")}</Link> : <span />}
          <span className="text-ink-2">{t("pageOf", { page: f.page, pages })}</span>
          {f.page < pages ? <Link href={`/activity?${qs({ page: String(f.page + 1) })}`} className={btnSecondary}>{t("next")} →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
