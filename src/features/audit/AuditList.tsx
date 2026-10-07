import { Data } from "@/components/Data";
import { getLocale, getTranslations } from "next-intl/server";
import { describeAudit, type AuditLabels, type AuditView } from "@/db/audit-describe";
import { dateTimeIn } from "@/lib/org-time";

/** Label bagian/kolom dari katalog pesan (detail.sections.*), dipakai describeAudit. */
export async function auditLabels(): Promise<AuditLabels> {
  const t = await getTranslations();
  return {
    section: (key) => (key && t.has(`detail.sections.${key}.title`) ? t(`detail.sections.${key}.title`) : undefined),
    field: (section, name) => (section && t.has(`detail.sections.${section}.fields.${name}`) ? t(`detail.sections.${section}.fields.${name}`) : undefined),
  };
}

/**
 * Daftar entri riwayat: waktu di zona organisasi, pelaku, kalimat. Satu daftar semantik (ul) yang rapi di layar lebar dan ponsel.
 * Entri lintas organisasi menampilkan nama ORGANISASI pelaku saja (nama orangnya memang tidak tersimpan).
 */
export async function AuditList({ rows, timezone, emptyText, testId = "audit-list" }: { rows: AuditView[]; timezone: string; emptyText: string; testId?: string }) {
  const locale = await getLocale();
  const labels = await auditLabels();
  const t = await getTranslations("activity");
  if (rows.length === 0) return <p className="text-sm text-ink-2" data-testid={`${testId}-empty`}>{emptyText}</p>;
  return (
    <ul className="divide-y divide-line" data-testid={testId}>
      {rows.map((e) => {
        const d = describeAudit(e, locale === "ja" ? "ja" : "id", labels);
        return (
          <li key={e.id} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:gap-4" data-testid="audit-row" data-action={e.action}>
            <time dateTime={new Date(e.createdAt).toISOString()} className="shrink-0 text-xs tabular-nums text-ink-2 sm:w-40">{dateTimeIn(e.createdAt, locale, timezone)}</time>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink" data-testid="audit-text">{d.text}</p>
              <p className="text-xs text-ink-2">{t("by")} <Data>{d.actor}</Data></p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
