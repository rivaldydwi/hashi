import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Data, dataTag } from "@/components/Data";
import { EmptyState } from "@/components/EmptyState";
import { btnPrimary, btnSecondary, cardClass } from "@/components/styles";
import { requireStaff } from "@/features/records/access";
import { WORKER_TIMELINE_PAGE_SIZE, openTasksOfWorker, workerBasics, workerTimeline, type TimelineItem } from "@/features/records/queries";
import { Badge, dateLabelSync } from "@/features/records/ui/common";
import { dateTimeIn, safeTimezone, ymdIn } from "@/lib/org-time";
import { responsibleOfWorker } from "@/db/responsibility-queries";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Riwayat satu pekerja (T-007): catatan ① dan ② yang menyebutnya, baris kronologi ③ dan wawancara berkala ④ miliknya dalam satu garis waktu
 * (terbaru di atas, bisa dibalik), plus tindak lanjut yang masih terbuka. Hanya staf TSK (layout /records: peran lain 404); pekerja yang tidak terlihat (RLS) = 404.
 */
export default async function WorkerHistoryPage({ params, searchParams }: { params: Promise<{ candidateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const { candidateId } = await params;
  if (!UUID.test(candidateId)) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const order = one(sp.order) === "asc" ? "asc" : "desc";
  const pageRaw = Number.parseInt(one(sp.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const t = await getTranslations("records");
  const locale = await getLocale();
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const data = await tenantQuery(async (tx) => {
    const w = await workerBasics(tx, candidateId);
    if (!w) return null;
    return { w, resp: await responsibleOfWorker(tx, candidateId, ymdIn(new Date(), tz)), tasks: await openTasksOfWorker(tx, candidateId), tl: await workerTimeline(tx, candidateId, { order, page, tz }) };
  });
  if (!data) notFound();
  const { w, resp, tasks, tl } = data;
  const tresp = await getTranslations("responsible");
  const pages = Math.max(1, Math.ceil(tl.total / WORKER_TIMELINE_PAGE_SIZE));
  const base = `/records/workers/${candidateId}`;
  const qs = (p: number, o = order) => {
    const q = new URLSearchParams();
    if (o === "asc") q.set("order", "asc");
    if (p > 1) q.set("page", String(p));
    return q.toString() ? `${base}?${q}` : base;
  };

  const hrefOf = (it: TimelineItem): string =>
    it.item === "record" ? `/records/${it.id}` : it.item === "event" ? `/records/cases/${it.caseId}` : `/records/interviews/${candidateId}/${it.period}`;
  const whenOf = (it: TimelineItem): string => (it.item === "record" && it.sub === "meeting" ? dateTimeIn(it.at, locale, tz) : dateLabelSync(ymdIn(it.at, tz), locale));
  const typeKey = (it: TimelineItem) => (it.item === "record" ? it.sub : it.item === "event" ? "timeline" : "interview");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-semibold" data-testid="worker-history-title">{t("whistory.title", { name: w.name })}</h2>
          {w.katakana && <p lang="ja" className="text-sm text-ink-2">{w.katakana}</p>}
          <p className="mt-1 text-sm text-ink-2">{t("whistory.intro")}</p>
          {resp && <p className="mt-1 text-sm" data-testid="worker-responsible">{tresp("form.staff")}: <span className="font-medium">{resp.name ?? tresp("none")}</span>{resp.name && <span className="text-xs text-ink-2"> ({tresp(`source.${resp.source}`)})</span>}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/records/new?kind=daily_work&worker=${candidateId}`} className={btnPrimary} data-testid="worker-new-daily">+ {t("whistory.newDaily")}</Link>
          <Link href={`/records/new?kind=meeting&worker=${candidateId}`} className={btnSecondary} data-testid="worker-new-meeting">+ {t("whistory.newMeeting")}</Link>
          <Link href={`/candidates/${candidateId}`} className={btnSecondary} data-testid="worker-profile">{t("whistory.profile")}</Link>
        </div>
      </header>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="wt-title" data-testid="worker-open-tasks">
        <h3 id="wt-title" className="text-[16px] font-semibold">{t("whistory.openTasks")} <span className="text-sm font-normal text-ink-2">({tasks.length})</span></h3>
        {tasks.length === 0 ? <p className="mt-2 text-sm text-ink-2" data-testid="worker-no-tasks">{t("whistory.noOpenTasks")}</p> : (
          <ul className="mt-2 space-y-2">
            {tasks.map((x) => (
              <li key={x.id} className="text-sm" data-testid="worker-task">
                <span lang="ja">{x.description}</span>{" "}
                <span className="text-xs text-ink-2">({x.assigneeName}{x.dueDate ? `, ${dateLabelSync(x.dueDate, locale)}` : ""})</span>{" "}
                <Link href={x.recordId ? `/records/${x.recordId}` : x.caseId ? `/records/cases/${x.caseId}` : `/records/tasks`} className="text-xs font-medium text-accent-text hover:underline">{t("whistory.openSource")}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wl-title">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 id="wl-title" className="text-[16px] font-semibold">{t("whistory.timeline")} <span className="text-sm font-normal text-ink-2" data-testid="worker-total">{t("whistory.total", { n: tl.total })}</span></h3>
          <nav aria-label={t("whistory.orderLabel")} className="flex gap-2 text-sm">
            <Link href={qs(1, "desc")} aria-current={order === "desc" ? "true" : undefined} className={`${btnSecondary} ${order === "desc" ? "!bg-accent-soft" : ""}`} data-testid="order-desc">{t("whistory.order.desc")}</Link>
            <Link href={qs(1, "asc")} aria-current={order === "asc" ? "true" : undefined} className={`${btnSecondary} ${order === "asc" ? "!bg-accent-soft" : ""}`} data-testid="order-asc">{t("whistory.order.asc")}</Link>
          </nav>
        </div>
        {tl.items.length === 0 ? (
          <EmptyState testId="worker-empty" title={t("whistory.emptyTitle")} body={t("whistory.emptyBody")} action={{ href: `/records/new?kind=daily_work&worker=${candidateId}`, label: `+ ${t("whistory.newDaily")}` }} />
        ) : (
          <ol className={`${cardClass} divide-y divide-line`} data-testid="worker-timeline" data-order={order}>
            {tl.items.map((it) => (
              <li key={`${it.item}-${it.id}`} data-testid="timeline-item" data-item={it.item} data-id={it.id} data-status={it.status}>
                <Link href={hrefOf(it)} className={`block px-4 py-3 hover:bg-hover ${it.status === "void" ? "opacity-70" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-ink-2">{whenOf(it)}</span>
                    <Badge tone={it.item === "record" ? "neutral" : it.item === "event" ? "warn" : "info"}>{t(`whistory.type.${typeKey(it)}`)}</Badge>
                    {it.status === "void" && <Badge tone="danger">{t("badge.void")}</Badge>}
                    {it.continuesId && <Badge tone="accent" testId="badge-continued">{t("whistory.continued")}</Badge>}
                    {it.openTasks > 0 && <Badge tone="info">{t("badge.tasks", { n: it.openTasks })}</Badge>}
                    {it.caseCode && <Badge><Data>{it.caseCode}</Data></Badge>}
                  </div>
                  {it.summary && <p lang="ja" translate="no" className={`mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-ink-menu ${it.status === "void" ? "line-through" : ""}`}>{it.summary}</p>}
                  {it.authorName && <p className="mt-1 text-xs text-ink-2">{t.rich("list.by", { name: it.authorName, n: dataTag })}</p>}
                </Link>
              </li>
            ))}
          </ol>
        )}
        {pages > 1 && (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
            {page > 1 ? <Link href={qs(page - 1)} className={btnSecondary}>← {t("list.prev")}</Link> : <span />}
            <span className="text-ink-2">{t("list.pageOf", { page, pages })}</span>
            {page < pages ? <Link href={qs(page + 1)} className={btnSecondary}>{t("list.next")} →</Link> : <span />}
          </nav>
        )}
      </section>
    </div>
  );
}
