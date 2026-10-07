import { getLocale, getTranslations } from "next-intl/server";
import { dataTag } from "@/components/Data";
import { cardClass, inputClass, labelClass } from "@/components/styles";
import { createFollowup, setFollowupStatus } from "../actions";
import type { StaffUser } from "../queries";
import { ActionForm } from "./ActionForm";
import { Badge, dateLabelSync } from "./common";

export type FollowupView = { id: string; description: string; dueDate: string | null; status: string; assigneeId: string; createdBy: string; assigneeName: string };

/** Daftar tugas tindak lanjut. Lewat tenggat ditandai ikon + teks. Tombol Selesai/Batalkan hanya untuk penanggung jawab, pembuat, atau TSK_ADMIN. */
export async function FollowupList({ items, me, today, empty }: { items: FollowupView[]; me: { id: string; role: string }; today: string; empty?: string }) {
  const t = await getTranslations("records");
  const locale = await getLocale();
  if (items.length === 0) return <p className="text-sm text-ink-2" data-testid="followups-empty">{empty ?? t("tasks.none")}</p>;
  return (
    <ul className="divide-y divide-line" data-testid="followup-list">
      {items.map((f) => {
        const overdue = f.status === "open" && f.dueDate !== null && f.dueDate < today;
        const can = f.status === "open" && (f.assigneeId === me.id || f.createdBy === me.id || me.role === "TSK_ADMIN");
        return (
          <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-testid="followup-item" data-status={f.status}>
            <div className="min-w-0 flex-1">
              <p lang="ja" translate="no" className={`whitespace-pre-wrap break-words text-sm ${f.status !== "open" ? "text-ink-2 line-through" : ""}`}>{f.description}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <span>{t.rich("tasks.assignee", { name: f.assigneeName, n: dataTag })}</span>
                {f.dueDate && <span>{t("tasks.due", { date: dateLabelSync(f.dueDate, locale) })}</span>}
                <Badge tone={f.status === "done" ? "ok" : f.status === "cancelled" ? "neutral" : "info"}>{t(`tasks.status.${f.status}`)}</Badge>
                {overdue && <Badge tone="danger" testId="badge-overdue">⚠ {t("tasks.overdue")}</Badge>}
              </p>
            </div>
            {can && (
              <div className="flex gap-2">
                <ActionForm action={setFollowupStatus} hidden={{ id: f.id, to: "done" }} submitLabel={t("tasks.markDone")} submitTone="secondary" testId="followup-done" />
                <ActionForm action={setFollowupStatus} hidden={{ id: f.id, to: "cancelled" }} submitLabel={t("tasks.cancel")} submitTone="secondary" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Form "Tambah tugas" terkait catatan/kasus/wawancara. */
export async function AddFollowupForm({ parent, staff, meId }: { parent: { recordId?: string; caseId?: string; interviewId?: string }; staff: StaffUser[]; meId: string }) {
  const t = await getTranslations("records");
  return (
    <details className={`${cardClass} mt-3`}>
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-accent-text" data-testid="add-followup-toggle">+ {t("tasks.add")}</summary>
      <ActionForm action={createFollowup} hidden={Object.fromEntries(Object.entries(parent).filter(([, v]) => v) as Array<[string, string]>)} submitLabel={t("tasks.save")} className="space-y-3 border-t border-line p-4" resetOnSuccess testId="add-followup-form">
        <div className="space-y-1.5"><label htmlFor="fu-desc" className={labelClass}>{t("tasks.what")} *</label><textarea id="fu-desc" name="description" required rows={2} lang="ja" maxLength={1000} className={`${inputClass} min-h-16 py-2`} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><label htmlFor="fu-who" className={labelClass}>{t("tasks.who")}</label>
            <select id="fu-who" name="assigneeId" defaultValue={meId} className={inputClass}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="space-y-1.5"><label htmlFor="fu-due" className={labelClass}>{t("tasks.dueLabel")}</label><input id="fu-due" name="dueDate" type="date" className={inputClass} /></div>
        </div>
      </ActionForm>
    </details>
  );
}
