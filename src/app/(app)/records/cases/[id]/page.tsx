import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { CASE_CATEGORIES } from "@/db/records-core";
import { requireStaff } from "@/features/records/access";
import { addTimelineEvent, saveCase, setCaseStatus, updateTimelineEvent, voidTimelineEvent } from "@/features/records/actions";
import { loadFormContext, localDateTime } from "@/features/records/form-context";
import { getCase, listStaff, timelineRevisions } from "@/features/records/queries";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { EventFields } from "@/features/records/ui/EventFields";
import { AddFollowupForm, FollowupList } from "@/features/records/ui/Followups";
import { WorkerPicker } from "@/features/records/ui/Pickers";
import { RevisionHistory, toSnake, type RevField } from "@/features/records/ui/RevisionHistory";
import { Badge, dateLabelSync } from "@/features/records/ui/common";
import { dateTimeIn, safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("records");
  const locale = await getLocale();
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const data = await tenantQuery(async (tx) => {
    const c = await getCase(tx, id);
    if (!c) return null;
    return { c, staff: await listStaff(tx), ctx: await loadFormContext(tx), evRevs: await timelineRevisions(tx, c.events.map((e) => e.e.id)) };
  });
  if (!data) notFound();
  const { c, staff, ctx, evRevs } = data;
  const k = c.c;
  const canEditCase = me.role === "TSK_ADMIN" || k.createdBy === me.id;
  const workers = [...ctx.workers];
  for (const s of c.subjects) if (!workers.some((w) => w.id === s.id)) workers.push({ id: s.id, name: s.name, katakana: s.katakana, site: "" });
  const names: Record<string, string> = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const caseFields: RevField[] = [{ key: "title", label: t("cases.titleLabel") }, { key: "category", label: t("cases.category") }, { key: "status", label: t("history.status") }];
  const evFields: RevField[] = [{ key: "occurred_at", label: t("f.tl_when"), kind: "time" }, { key: "event", label: t("f.tl_event") }, { key: "subject_statement", label: t("f.tl_subjectStatement") }, { key: "company_response", label: t("f.tl_companyResponse") }, { key: "note", label: t("f.tl_note") }, { key: "include_in_client_export", label: t("cases.includeInClient"), kind: "bool" }, { key: "status", label: t("history.status") }, { key: "void_reason", label: t("history.voidReason") }];
  const evDefaults = (e: (typeof c.events)[number]["e"]) => ({
    date: localDateTime(e.occurredAt, tz).slice(0, 10), time: e.timeKnown ? localDateTime(e.occurredAt, tz).slice(11) : "", event: e.event, subjectStatement: e.subjectStatement ?? "", companyResponse: e.companyResponse ?? "", note: e.note ?? "", includeInClientExport: e.includeInClientExport,
  });
  const th = "px-3 py-2 text-left text-xs font-semibold text-ink-2";
  const td = "px-3 py-3 align-top text-sm";

  return (
    <div className="space-y-5">
      <section className={`${cardClass} p-4 sm:p-5`} data-testid="case-detail" data-status={k.status}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-ink-2" data-testid="case-code">{k.code}</span>
          <h2 lang="ja" className="text-[19px] font-semibold" data-testid="case-title">{k.title}</h2>
          <Badge tone={k.status === "open" ? "warn" : "ok"} testId="case-status">{k.status === "open" ? "● " : "✓ "}{t(`cases.status.${k.status}`)}</Badge>
          <Badge>{t(`categories.${k.category}`)}</Badge>
          {k.versionNo > 1 && <Badge>{t("badge.version", { n: k.versionNo })}</Badge>}
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {t("cases.openedOn", { date: dateLabelSync(ymdIn(k.openedAt, tz), locale) })}
          {k.closedAt && ` · ${t("cases.closedOn", { date: dateLabelSync(ymdIn(k.closedAt, tz), locale) })}`}
        </p>
        <p className="mt-2 flex flex-wrap gap-2 text-sm" data-testid="case-workers">
          {c.subjects.length === 0 ? <span className="text-ink-2">{t("cases.noWorkers")}</span> : c.subjects.map((s) => <Link key={s.id} href={`/candidates/${s.id}`} className="font-medium text-accent-text hover:underline">{s.name}</Link>)}
        </p>
        <div className="mt-4 flex flex-wrap items-start gap-2">
          <ActionForm action={setCaseStatus} hidden={{ id: k.id, to: k.status === "open" ? "closed" : "open" }} submitLabel={k.status === "open" ? t("cases.close") : t("cases.reopen")} submitTone="secondary" testId="case-status-form" />
          <a href={`/records/export/case/${k.id}?mode=internal`} className={`${btnSecondary} mt-3`} data-testid="export-case-internal">{t("export.caseInternal")}</a>
          <Link href={`/records/cases/${k.id}/export`} className={`${btnSecondary} mt-3`} data-testid="export-case-client">{t("export.caseClient")}</Link>
          <Link href={`/records/new?kind=meeting&case=${k.id}`} className={`${btnSecondary} mt-3`}>{t("cases.addMeeting")}</Link>
          <Link href={`/records/new?kind=daily_work&case=${k.id}`} className={`${btnSecondary} mt-3`}>{t("cases.addDaily")}</Link>
        </div>
        {canEditCase && (
          <details className="mt-3 rounded-xl border border-line p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-accent-text" data-testid="edit-case-toggle">{t("cases.edit")}</summary>
            <ActionForm action={saveCase} hidden={{ id: k.id }} submitLabel={t("cases.saveChanges")} className="mt-2 space-y-3" testId="edit-case-form">
              <div className="space-y-1.5"><label htmlFor="e-title" className={labelClass}>{t("cases.titleLabel")} *</label><input id="e-title" name="title" required defaultValue={k.title} lang="ja" maxLength={300} className={inputClass} /></div>
              <div className="space-y-1.5"><label htmlFor="e-cat" className={labelClass}>{t("cases.category")}</label>
                <select id="e-cat" name="category" defaultValue={k.category} className={inputClass}>{CASE_CATEGORIES.map((x) => <option key={x} value={x}>{t(`categories.${x}`)}</option>)}</select></div>
              <div className="space-y-1.5"><span className={labelClass}>{t("cases.workers")}</span><WorkerPicker workers={workers} selected={c.subjects.map((s) => s.id)} id="case-workers" /></div>
            </ActionForm>
          </details>
        )}
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="tl-title" data-testid="timeline">
        <h2 id="tl-title" className="text-[17px] font-semibold">{t("cases.timeline")}</h2>
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse" data-testid="timeline-table">
            <thead className="border-b border-line bg-page"><tr>
              <th className={th}>{t("f.tl_when")}</th><th className={th}>{t("f.tl_event")}</th><th className={th}>{t("f.tl_subjectStatement")}</th><th className={th}>{t("f.tl_companyResponse")}</th><th className={th}>{t("f.tl_note")}</th><th className={th}><span className="sr-only">{t("cases.rowActions")}</span></th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {c.events.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-sm text-ink-2">{t("cases.noEvents")}</td></tr>}
              {c.events.map(({ e, creatorName }) => {
                const isVoid = e.status === "void";
                const canEdit = !isVoid && (e.createdBy === me.id || me.role === "TSK_ADMIN");
                const when = e.timeKnown ? dateTimeIn(e.occurredAt, locale, tz) : dateLabelSync(localDateTime(e.occurredAt, tz).slice(0, 10), locale);
                return (
                  <tr key={e.id} className={isVoid ? "opacity-60" : ""} data-testid="timeline-row" data-status={e.status}>
                    <td className={`${td} whitespace-nowrap`}>{when}{e.sourceRecordId && <div><Link href={`/records/${e.sourceRecordId}`} className="text-xs text-accent-text underline">{t("cases.fromRecord")}</Link></div>}</td>
                    <td className={`${td} ${isVoid ? "line-through" : ""}`} lang="ja"><span className="whitespace-pre-wrap break-words">{e.event}</span>{isVoid && <div className="no-underline"><Badge tone="danger">{t("badge.void")}</Badge> <span className="text-xs">{e.voidReason}</span></div>}</td>
                    <td className={td} lang="ja"><span className="whitespace-pre-wrap break-words">{e.subjectStatement ?? "—"}</span></td>
                    <td className={td} lang="ja"><span className="whitespace-pre-wrap break-words">{e.companyResponse ?? "—"}</span></td>
                    <td className={td} lang="ja"><span className="whitespace-pre-wrap break-words">{e.note ?? "—"}</span>{!e.includeInClientExport && <div><Badge>{t("cases.internalOnly")}</Badge></div>}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <p className="mb-1 text-xs text-ink-2">{t("cases.writtenBy", { name: creatorName })}{e.versionNo > 1 && ` · ${t("badge.version", { n: e.versionNo })}`}</p>
                      {canEdit && (
                        <details>
                          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-accent-text" data-testid="edit-event-toggle">{t("cases.editEvent")}</summary>
                          <div className="mt-2 w-80 max-w-[80vw] space-y-3 whitespace-normal">
                            <ActionForm action={updateTimelineEvent} hidden={{ id: e.id }} submitLabel={t("cases.saveChanges")} testId="edit-event-form">
                              <EventFields d={evDefaults(e)} prefix={`ev-${e.id}`} />
                            </ActionForm>
                            <ActionForm action={voidTimelineEvent} hidden={{ id: e.id }} submitLabel={t("cases.voidEvent")} submitTone="danger" testId="void-event-form">
                              <label htmlFor={`vr-${e.id}`} className={labelClass}>{t("detail.voidReason")} *</label>
                              <textarea id={`vr-${e.id}`} name="reason" required rows={2} lang="ja" maxLength={1000} className={`${inputClass} min-h-16 py-2`} />
                            </ActionForm>
                          </div>
                        </details>
                      )}
                      {(evRevs.get(e.id)?.length ?? 0) > 0 && (
                        <details>
                          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-ink-menu" data-testid="event-history-toggle">{t("history.title")}</summary>
                          <div className="w-80 max-w-[80vw] whitespace-normal"><RevisionHistory revisions={evRevs.get(e.id)!} current={toSnake(e as unknown as Record<string, unknown>)} fields={evFields} names={names} tz={tz} testId="event-history" /></div>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details className="mt-4 rounded-xl border border-line" open={c.events.length === 0}>
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-accent-text" data-testid="add-event-toggle">+ {t("cases.addEvent")}</summary>
          <ActionForm action={addTimelineEvent} hidden={{ caseId: k.id }} submitLabel={t("cases.addEventSave")} className="border-t border-line p-4" resetOnSuccess testId="add-event-form">
            <EventFields d={{ date: today, time: "", event: "", subjectStatement: "", companyResponse: "", note: "", includeInClientExport: true }} prefix="new" />
          </ActionForm>
        </details>
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="rel-title">
        <h2 id="rel-title" className="text-[17px] font-semibold">{t("cases.relatedRecords")}</h2>
        {c.records.length === 0 ? <p className="mt-2 text-sm text-ink-2">{t("cases.noRecords")}</p> : (
          <ul className="mt-2 divide-y divide-line" data-testid="related-records">
            {c.records.map((r) => (
              <li key={r.id}><Link href={`/records/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-2 py-2 text-sm hover:bg-hover">
                <Badge>{t(`kinds.${r.kind}`)}</Badge><span className={r.status === "void" ? "line-through" : ""}>{dateLabelSync(r.recordDate, locale)} · {r.kind === "meeting" ? r.subject : t(`workTypes.${r.workType ?? "other"}`)}</span><span className="text-xs text-ink-2">{r.authorName}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="fu-title" data-testid="case-followups">
        <h2 id="fu-title" className="text-[17px] font-semibold">{t("tasks.title")}</h2>
        <FollowupList items={c.followups.map((x) => ({ ...x.f, assigneeName: x.assigneeName }))} me={me} today={today} />
        <AddFollowupForm parent={{ caseId: k.id }} staff={staff} meId={me.id} />
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="ch-title">
        <h2 id="ch-title" className="mb-3 text-[17px] font-semibold">{t("history.title")}</h2>
        <RevisionHistory revisions={c.revisions} current={toSnake(k as unknown as Record<string, unknown>)} fields={caseFields} names={names} tz={tz} testId="case-history" />
      </section>
    </div>
  );
}
