import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import { requireStaff } from "@/features/records/access";
import { listStaff, listTasks, parseTaskFilters } from "@/features/records/queries";
import { FollowupList } from "@/features/records/ui/Followups";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Tab Tindak lanjut (未対応・継続事項 sebagai tugas): milikku/semua, terbuka/selesai/dibatalkan/lewat tenggat. Pengingat hanya di dalam aplikasi. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  const f = parseTaskFilters(await searchParams);
  const today = ymdIn(new Date(), safeTimezone(me.organizationTimezone, me.organizationType));
  const { rows } = await tenantQuery(async (tx) => ({ rows: await listTasks(tx, f, me.id, today), staff: await listStaff(tx) }));
  const href = (over: Partial<Record<"scope" | "status", string>>) => `/records/tasks?scope=${over.scope ?? f.scope}&status=${over.status ?? f.status}`;
  const pill = (on: boolean) => `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${on ? "border-accent bg-accent-soft text-accent-text" : "border-line-btn bg-card text-ink-menu hover:bg-hover"}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" data-testid="task-filters">
        {(["mine", "all"] as const).map((s) => <Link key={s} href={href({ scope: s })} className={pill(f.scope === s)} aria-current={f.scope === s ? "true" : undefined} data-testid={`scope-${s}`}>{t(`tasks.scope.${s}`)}</Link>)}
        <span aria-hidden className="mx-1 w-px bg-line" />
        {(["open", "overdue", "done", "cancelled"] as const).map((s) => <Link key={s} href={href({ status: s })} className={pill(f.status === s)} aria-current={f.status === s ? "true" : undefined} data-testid={`status-${s}`}>{t(`tasks.filter.${s}`)}</Link>)}
      </div>
      <p className="mb-2 text-sm text-ink-2"><span className="font-medium tabular-nums text-ink" data-testid="tasks-total">{rows.length}</span> {t("tasks.totalSuffix")}</p>
      <div className={`${cardClass} px-4`}>
        <FollowupList items={rows.map((r) => ({ id: r.id, description: r.description, dueDate: r.dueDate, status: r.status, assigneeId: r.assigneeId, createdBy: r.createdBy, assigneeName: r.assigneeName }))} me={me} today={today} />
      </div>
      {rows.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link className="underline" href={r.recordId ? `/records/${r.recordId}` : r.caseId ? `/records/cases/${r.caseId}` : r.interviewCandidateId ? `/records/interviews/${r.interviewCandidateId}/${r.interviewMonth}` : "/records/tasks"}>
                {t("tasks.openParent")}: {r.description.slice(0, 40)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
