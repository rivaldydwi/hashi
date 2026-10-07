import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Data, dataTag } from "@/components/Data";
import { EmptyState } from "@/components/EmptyState";
import { cardClass } from "@/components/styles";
import { dateTimeIn } from "@/lib/org-time";
import type { RecordRow } from "../queries";
import { Badge, dateLabelSync } from "./common";

/** Daftar catatan (① atau ②) dikelompokkan per hari. Setiap kartu: jenis/perihal, pekerja, penulis, dan penanda (belum dibaca, diperbarui, dibatalkan, tugas, foto). */
export async function RecordList({ rows, tz, emptyAction, filtered, base = "/records" }: { rows: RecordRow[]; tz: string; emptyAction?: { href: string; label: string }; filtered: boolean; base?: string }) {
  const t = await getTranslations("records");
  const locale = await getLocale();
  if (rows.length === 0) {
    return <EmptyState testId="records-empty" title={filtered ? t("list.noMatchTitle") : t("list.emptyTitle")} body={filtered ? t("list.noMatchBody") : t("list.emptyBody")} action={filtered ? { href: base, label: t("list.clearFilters") } : emptyAction} />;
  }
  const groups = new Map<string, RecordRow[]>();
  for (const r of rows) groups.set(r.recordDate, [...(groups.get(r.recordDate) ?? []), r]);
  return (
    <div className="space-y-6" data-testid="records-list">
      {[...groups.entries()].map(([date, items]) => (
        <section key={date} aria-labelledby={`g-${date}`} data-testid="record-group">
          <h2 id={`g-${date}`} className="mb-2 flex items-baseline gap-2 text-[15px] font-semibold text-ink">
            {dateLabelSync(date, locale)} <span className="text-xs font-normal text-ink-2">{t("list.count", { n: items.length })}</span>
          </h2>
          <ul className={`${cardClass} divide-y divide-line`}>
            {items.map((r) => (
              <li key={r.id}>
                <Link href={`/records/${r.id}`} className={`block px-4 py-3 hover:bg-hover ${r.status === "void" ? "opacity-70" : ""}`} data-testid="record-row" data-record-id={r.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span translate={r.kind === "meeting" || (r.workType === "other" && r.workTypeOther) ? "no" : undefined} className={`text-sm font-semibold ${r.status === "void" ? "line-through" : ""}`}>
                      {r.kind === "meeting" ? r.subject : r.workType === "other" && r.workTypeOther ? r.workTypeOther : t(`workTypes.${r.workType ?? "other"}`)}
                    </span>
                    {r.kind === "meeting" && r.startedAt && <span className="text-xs text-ink-2">{dateTimeIn(r.startedAt, locale, tz)}</span>}
                    {r.status === "void" && <Badge tone="danger">{t("badge.void")}</Badge>}
                    {r.unreadForMe && <Badge tone="accent" testId="badge-unread">{t("badge.unread")}</Badge>}
                    {r.staleForMe && <Badge tone="warn" testId="badge-updated">{t("badge.updatedSinceRead")}</Badge>}
                    {r.versionNo > 1 && r.status === "active" && <Badge>{t("badge.version", { n: r.versionNo })}</Badge>}
                    {r.openTasks > 0 && <Badge tone="info">{t("badge.tasks", { n: r.openTasks })}</Badge>}
                    {r.photos > 0 && <Badge>{t("badge.photos", { n: r.photos })}</Badge>}
                    {r.caseCode && <Badge><Data>{r.caseCode}</Data></Badge>}
                  </div>
                  {r.kind === "daily_work" && r.actionTaken && <p lang="ja" translate="no" className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-ink-menu">{r.actionTaken}</p>}
                  <p className="mt-1 text-xs text-ink-2">
                    {t.rich("list.by", { name: r.authorName, n: dataTag })}
                    {r.workers.length > 0 && <Data>{` · ${r.workers.map((w) => w.name).join(", ")}`}</Data>}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
