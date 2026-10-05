import { getLocale, getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import { dateTimeIn } from "@/lib/org-time";
import { shareDailyReport } from "../actions";
import type { DailyReportState, StaffUser } from "../queries";
import { Badge } from "./common";
import { ActionForm } from "./ActionForm";
import { StaffPicker } from "./Pickers";

/** Kartu "Laporan hari ini" milik sendiri: jumlah ①, tombol kirim ke leader (atau kirim ulang), penerima dan siapa yang sudah membaca. */
export async function DailyReportCard({ state, date, tz, staff, meId, roleLabels }: { state: DailyReportState; date: string; tz: string; staff: StaffUser[]; meId: string; roleLabels: Record<string, string> }) {
  const t = await getTranslations("records");
  const locale = await getLocale();
  const sent = state.report?.sharedAt ?? null;
  return (
    <section className={`${cardClass} mb-5 p-4`} data-testid="daily-report-card" aria-labelledby="dr-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="dr-title" className="text-[17px] font-semibold">{t("report.title")}</h2>
        <Badge tone={sent ? "ok" : "neutral"} testId="report-state">{sent ? t("report.sentAt", { time: dateTimeIn(sent, locale, tz) }) : t("report.notSent")}</Badge>
        {state.addedAfter > 0 && <Badge tone="warn" testId="report-added-after">{t("report.addedAfter", { n: state.addedAfter })}</Badge>}
        {state.editedAfter > 0 && <Badge tone="warn" testId="report-edited-after">{t("report.editedAfter", { n: state.editedAfter })}</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink-2" data-testid="report-count">{t("report.count", { n: state.count })}</p>
      {sent && state.recipients.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm" data-testid="report-recipients">
          {state.recipients.map((r) => (
            <li key={r.userId}>{r.name}: {r.readAt ? t("report.readAt", { time: dateTimeIn(r.readAt, locale, tz) }) : t("report.notRead")}</li>
          ))}
        </ul>
      )}
      {state.count > 0 && (
        <details className="mt-3">
          <summary data-testid="report-send-toggle" className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-accent-text">{sent ? t("report.resend") : t("report.send")}</summary>
          <ActionForm action={shareDailyReport} hidden={{ date }} submitLabel={sent ? t("report.resend") : t("report.send")} className="mt-2 space-y-3" testId="share-report-form">
            <p className="text-sm text-ink-2">{t("report.recipientsHint")}</p>
            <StaffPicker staff={staff.filter((s) => s.id !== meId && s.role !== "TSK_ADMIN")} selected={[]} name="recipients" legend={t("report.extraRecipients")} roleLabels={roleLabels} />
          </ActionForm>
        </details>
      )}
    </section>
  );
}
