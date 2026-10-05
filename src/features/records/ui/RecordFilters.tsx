import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { WORK_TYPES } from "@/db/records-core";
import type { RecordFilters as F, StaffUser } from "../queries";

/** Filter daftar catatan: form GET biasa + chip filter aktif (tiap chip punya tautan hapus). */
export async function RecordFilters({ f, base, staff, workers, cases }: { f: F; base: string; staff: StaffUser[]; workers: Array<{ id: string; name: string }>; cases: Array<{ id: string; label: string }> }) {
  const t = await getTranslations("records");
  const chips: Array<{ key: string; text: string }> = [];
  const nameOf = (list: Array<{ id: string; name?: string; label?: string }>, id: string) => list.find((x) => x.id === id)?.name ?? list.find((x) => x.id === id)?.label ?? id;
  if (f.unread) chips.push({ key: "view", text: t("filters.unread") });
  if (f.from) chips.push({ key: "from", text: t("filters.from", { v: f.from }) });
  if (f.to) chips.push({ key: "to", text: t("filters.to", { v: f.to }) });
  if (f.staff) chips.push({ key: "staff", text: t("filters.staff", { v: nameOf(staff, f.staff) }) });
  if (f.worker) chips.push({ key: "worker", text: t("filters.worker", { v: nameOf(workers, f.worker) }) });
  if (f.workType) chips.push({ key: "workType", text: t("filters.workType", { v: t(`workTypes.${f.workType}`) }) });
  if (f.caseId) chips.push({ key: "case", text: t("filters.case", { v: nameOf(cases, f.caseId) }) });
  if (f.openTasks) chips.push({ key: "tasks", text: t("filters.openTasks") });
  const cur: Record<string, string> = { view: f.unread ? "unread" : "", from: f.from, to: f.to, staff: f.staff, worker: f.worker, workType: f.workType, case: f.caseId, tasks: f.openTasks ? "open" : "" };
  const without = (k: string) => {
    const p = new URLSearchParams();
    for (const [key, v] of Object.entries(cur)) if (v && key !== k) p.set(key, v);
    return p.toString() ? `${base}?${p}` : base;
  };
  return (
    <>
      <details className={`${cardClass} mb-3`} open={chips.length > 0 && false}>
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-ink-menu">{t("filters.title")}</summary>
        <form method="get" action={base} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3" data-testid="records-filters">
          <div className="space-y-1.5"><label htmlFor="from" className={labelClass}>{t("filters.fromLabel")}</label><input id="from" name="from" type="date" defaultValue={f.from} className={inputClass} /></div>
          <div className="space-y-1.5"><label htmlFor="to" className={labelClass}>{t("filters.toLabel")}</label><input id="to" name="to" type="date" defaultValue={f.to} className={inputClass} /></div>
          <div className="space-y-1.5"><label htmlFor="staff" className={labelClass}>{t("filters.staffLabel")}</label>
            <select id="staff" name="staff" defaultValue={f.staff} className={inputClass}><option value="">{t("filters.all")}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="space-y-1.5"><label htmlFor="worker" className={labelClass}>{t("filters.workerLabel")}</label>
            <select id="worker" name="worker" defaultValue={f.worker} className={inputClass}><option value="">{t("filters.all")}</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
          {f.kind === "daily_work" && (
            <div className="space-y-1.5"><label htmlFor="workType" className={labelClass}>{t("filters.workTypeLabel")}</label>
              <select id="workType" name="workType" defaultValue={f.workType} className={inputClass}><option value="">{t("filters.all")}</option>{WORK_TYPES.map((w) => <option key={w} value={w}>{t(`workTypes.${w}`)}</option>)}</select></div>
          )}
          <div className="space-y-1.5"><label htmlFor="case" className={labelClass}>{t("filters.caseLabel")}</label>
            <select id="case" name="case" defaultValue={f.caseId} className={inputClass}><option value="">{t("filters.all")}</option>{cases.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div className="flex flex-wrap items-end gap-4 sm:col-span-3">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="view" value="unread" defaultChecked={f.unread} className="h-5 w-5" />{t("filters.unreadLabel")}</label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="tasks" value="open" defaultChecked={f.openTasks} className="h-5 w-5" />{t("filters.openTasksLabel")}</label>
            <button type="submit" className={btnPrimary}>{t("filters.apply")}</button>
            {chips.length > 0 && <Link href={base} className={btnSecondary}>{t("filters.reset")}</Link>}
          </div>
        </form>
      </details>
      {chips.length > 0 && (
        <ul className="mb-3 flex flex-wrap items-center gap-2" aria-label={t("filters.active")} data-testid="filter-chips">
          {chips.map((c) => (
            <li key={c.key} data-testid="filter-chip" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">
              {c.text}
              <Link href={without(c.key)} aria-label={t("filters.remove", { name: c.text })} data-testid="filter-chip-remove" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
