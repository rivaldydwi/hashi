import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import type { RecentRecord, WorkerTask } from "../queries";
import { Badge, dateLabelSync } from "./common";

/** Panel baca-saja di samping form "Lanjutkan": 3 catatan terakhir pekerja + tindak lanjut yang masih terbuka (T-007). */
export async function ContinuePanel({ worker, recent, tasks, parentDate }: { worker: { id: string; name: string }; recent: RecentRecord[]; tasks: WorkerTask[]; parentDate: string }) {
  const t = await getTranslations("records");
  const locale = await getLocale();
  return (
    <aside className={`${cardClass} space-y-4 p-4 sm:p-5`} aria-labelledby="continue-title" data-testid="continue-panel">
      <div>
        <h3 id="continue-title" className="text-[15px] font-semibold">{t("continue.panelTitle", { name: worker.name })}</h3>
        <p className="mt-1 text-xs text-ink-2" data-testid="continue-intro">{t("continue.intro", { date: dateLabelSync(parentDate, locale) })}</p>
      </div>
      <div>
        <h4 className="text-[13px] font-semibold text-ink-2">{t("continue.recent")}</h4>
        {recent.length === 0 ? <p className="mt-1 text-sm text-ink-2">{t("continue.noRecent")}</p> : (
          <ul className="mt-1 space-y-2" data-testid="continue-recent">
            {recent.map((r) => (
              <li key={r.id} className="text-sm" data-testid="continue-recent-item">
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-ink-2">{dateLabelSync(r.recordDate, locale)}</span><Badge>{t(`kinds.${r.kind}`)}</Badge></div>
                <Link href={`/records/${r.id}`} className="line-clamp-2 whitespace-pre-wrap text-ink hover:underline" target="_blank" rel="noopener">{r.summary || "—"}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="text-[13px] font-semibold text-ink-2">{t("continue.openTasks")}</h4>
        {tasks.length === 0 ? <p className="mt-1 text-sm text-ink-2" data-testid="continue-no-tasks">{t("continue.noTasks")}</p> : (
          <ul className="mt-1 list-disc space-y-1 pl-5" data-testid="continue-tasks">
            {tasks.map((x) => <li key={x.id} className="text-sm" data-testid="continue-task">{x.description} <span className="text-xs text-ink-2">({x.assigneeName}{x.dueDate ? `, ${x.dueDate}` : ""})</span></li>)}
          </ul>
        )}
      </div>
      <Link href={`/records/workers/${worker.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent-text hover:underline" target="_blank" rel="noopener">{t("continue.allHistory")} →</Link>
    </aside>
  );
}
