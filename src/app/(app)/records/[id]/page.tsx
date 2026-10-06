import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { MAX_ATTACHMENTS_PER_RECORD, SECTION_KEYS, cleanSections } from "@/db/records-core";
import { addRecordToTimeline, createCaseFromRecord, markRecordRead, voidRecord } from "@/features/records/actions";
import { requireStaff } from "@/features/records/access";
import { continuationOf, getRecord, listCases, listStaff } from "@/features/records/queries";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { Attachments } from "@/features/records/ui/Attachments";
import { AddFollowupForm, FollowupList } from "@/features/records/ui/Followups";
import { RevisionHistory, toSnake, type RevField } from "@/features/records/ui/RevisionHistory";
import { Badge, Multiline, dateLabelSync } from "@/features/records/ui/common";
import { CASE_CATEGORIES } from "@/db/records-core";
import { dateTimeIn, safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RecordDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const t = await getTranslations("records");
  const locale = await getLocale();
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const { rec, staff, cases, names, chain } = await tenantQuery(async (tx) => {
    const rec = await getRecord(tx, id);
    const chain = rec ? await continuationOf(tx, id) : { from: null, by: [] };
    const staff = await listStaff(tx);
    const cases = await listCases(tx, { status: "open", workerId: "" });
    const names: Record<string, string> = Object.fromEntries(staff.map((s) => [s.id, s.name]));
    if (rec) {
      for (const s of rec.subjects) names[s.id] = s.name;
      if (rec.r.caseId && rec.caseCode) names[rec.r.caseId] = rec.caseCode;
      if (rec.r.clientSiteId && rec.siteName) names[rec.r.clientSiteId] = `${rec.companyName} / ${rec.siteName}`;
    }
    return { rec, staff, cases, names, chain };
  });
  if (!rec) notFound();
  const r = rec.r;
  const isVoid = r.status === "void";
  const canEdit = !isVoid && (r.authorId === me.id || r.createdBy === me.id || me.role === "TSK_ADMIN");
  const myRead = rec.reads.find((x) => x.userId === me.id);
  const iRead = myRead && myRead.versionNoRead >= r.versionNo;
  const sections = cleanSections(r.sections);
  const readIds = new Set(rec.reads.map((x) => x.userId));
  const pendingRecipients = rec.recipients.filter((x) => !readIds.has(x.id));

  const fields: RevField[] = [
    { key: "record_date", label: t("f.date") }, { key: "author_id", label: t("f.author") }, { key: "subject_ids", label: t("f.subjects"), kind: "ids" },
    { key: "client_site_id", label: t("f.site") }, { key: "case_id", label: t("f.case") },
    ...(r.kind === "daily_work"
      ? [{ key: "work_type", label: t("f.workType") }, { key: "work_type_other", label: t("f.workTypeOther") }, { key: "action_taken", label: t("f.actionTaken") }, { key: "result", label: t("f.result") }, { key: "pending", label: t("f.pending") }, { key: "next_action", label: t("f.nextAction") }, { key: "report_to_text", label: t("f.reportToText") }, { key: "note", label: t("f.note") }]
      : [{ key: "subject", label: t("f.meetingSubject") }, { key: "started_at", label: t("f.startedAt"), kind: "time" as const }, { key: "ended_at", label: t("f.endedAt"), kind: "time" as const }, { key: "method", label: t("f.placeMethod") }, { key: "counterparty", label: t("f.counterparty") }, { key: "handler_ids", label: t("f.handlers"), kind: "ids" as const }, { key: "sections", label: t("f.sectionsTitle") }]),
    { key: "status", label: t("history.status") }, { key: "void_reason", label: t("history.voidReason") },
  ];
  const current = { ...toSnake(r as unknown as Record<string, unknown>), subject_ids: rec.subjects.map((s) => s.id).sort(), handler_ids: rec.handlers.map((h) => h.id).sort() };

  const dl = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]"><dt className="text-[13px] font-medium text-ink-2">{label}</dt><dd>{value}</dd></div>
  );
  const photoFailed = Number(Array.isArray(sp.photoFailed) ? sp.photoFailed[0] : sp.photoFailed ?? 0);

  return (
    <div className="space-y-5">
      {photoFailed > 0 && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="photo-failed">{t("photos.someFailed", { n: photoFailed })}</p>}

      <section className={`${cardClass} p-4 sm:p-5`} data-testid="record-detail" data-status={r.status}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={`text-[19px] font-semibold ${isVoid ? "line-through" : ""}`} data-testid="record-title">
            {r.kind === "meeting" ? r.subject : r.workType === "other" && r.workTypeOther ? r.workTypeOther : t(`workTypes.${r.workType ?? "other"}`)}
          </h2>
          <Badge>{r.kind === "meeting" ? t("kinds.meeting") : t("kinds.daily_work")}</Badge>
          {isVoid && <Badge tone="danger" testId="badge-void">{t("badge.void")}</Badge>}
          {!isVoid && r.versionNo > 1 && <Badge testId="badge-version">{t("badge.version", { n: r.versionNo })}</Badge>}
          {!isVoid && !iRead && r.authorId !== me.id && <Badge tone="accent">{myRead ? t("badge.updatedSinceRead") : t("badge.unread")}</Badge>}
        </div>
        {isVoid && <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900" data-testid="void-reason">{t("detail.voidedBecause")}: <span lang="ja">{r.voidReason}</span></p>}

        <dl className="mt-3 divide-y divide-line">
          {dl(t("f.date"), dateLabelSync(r.recordDate, locale))}
          {dl(t("f.author"), rec.authorName)}
          {dl(t("f.subjects"), rec.subjects.length ? (
            <ul className="flex flex-wrap gap-2">{rec.subjects.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2"><Link href={`/candidates/${s.id}`} className="text-sm font-medium text-accent-text hover:underline">{s.name}</Link><Link href={`/records/workers/${s.id}`} className="inline-flex min-h-11 items-center text-xs font-medium text-accent-text hover:underline" data-testid="worker-history-link">{t("whistory.historyLink")}</Link></li>)}</ul>
          ) : <span className="text-ink-2">—</span>)}
          {dl(t("f.site"), rec.siteName ? `${rec.companyName} / ${rec.siteName}` : "—")}
          {dl(t("f.case"), r.caseId ? <Link href={`/records/cases/${r.caseId}`} className="text-sm font-medium text-accent-text hover:underline">{rec.caseCode} {rec.caseTitle}</Link> : "—")}
          {r.kind === "daily_work" ? (
            <>
              {dl(t("f.actionTaken"), <Multiline text={r.actionTaken} />)}
              {dl(t("f.result"), <Multiline text={r.result} />)}
              {dl(t("f.pending"), <Multiline text={r.pending} />)}
              {dl(t("f.nextAction"), <Multiline text={r.nextAction} />)}
              {dl(t("f.reportTo"), <div className="space-y-1"><Multiline text={r.reportToText} />{rec.recipients.length > 0 && <p className="text-xs text-ink-2">{t("f.reportToApp")}: {rec.recipients.map((x) => x.name).join(", ")}</p>}</div>)}
              {dl(t("f.note"), <Multiline text={r.note} />)}
            </>
          ) : (
            <>
              {dl(t("f.startedAt"), r.startedAt ? dateTimeIn(r.startedAt, locale, tz) : "—")}
              {dl(t("f.endedAt"), r.endedAt ? dateTimeIn(r.endedAt, locale, tz) : "—")}
              {dl(t("f.placeMethod"), r.method ? t(`methods.${r.method}`) : "—")}
              {dl(t("f.counterparty"), r.counterparty ? t(`counterparties.${r.counterparty}`) : "—")}
              {dl(t("f.handlers"), rec.handlers.map((h) => h.name).join(", ") || "—")}
            </>
          )}
        </dl>
        {r.kind === "meeting" && (
          <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="meeting-sections">
            {SECTION_KEYS.filter((k) => sections[k]?.length).map((k, i) => (
              <div key={k}>
                <h3 className="text-sm font-semibold">{i + 1}. {t(`sections.${k}`)}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">{sections[k]!.map((p, j) => <li key={j} lang="ja" className="whitespace-pre-wrap break-words text-sm">{p}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {(chain.from || chain.by.length > 0) && (
          <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm" data-testid="continuation-chain">
            {chain.from && (
              <p data-testid="continued-from">{t("continue.from")}: <Link href={`/records/${chain.from.id}`} className="font-medium text-accent-text hover:underline" lang="ja">{dateLabelSync(chain.from.recordDate, locale)} {chain.from.summary ? `· ${chain.from.summary}` : ""}</Link>{chain.from.status === "void" && <> <Badge tone="danger">{t("badge.void")}</Badge></>}</p>
            )}
            {chain.by.map((c) => (
              <p key={c.id} data-testid="continued-by">{t("continue.by")}: <Link href={`/records/${c.id}`} className="font-medium text-accent-text hover:underline" lang="ja">{dateLabelSync(c.recordDate, locale)} {c.summary ? `· ${c.summary}` : ""}</Link>{c.status === "void" && <> <Badge tone="danger">{t("badge.void")}</Badge></>}</p>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!isVoid && rec.subjects.length > 0 && <Link href={`/records/new?kind=${r.kind}&continue=${r.id}`} className={btnSecondary} data-testid="continue-record">{t("continue.button")}</Link>}
          {canEdit && <Link href={`/records/${r.id}/edit`} className={btnPrimary} data-testid="edit-record">{t("detail.edit")}</Link>}
          <a href={`/records/export/record/${r.id}`} className={btnSecondary} data-testid="export-record">{t("export.record")}</a>
        </div>
      </section>

      <Attachments items={rec.attachments} parent={{ recordId: r.id }} canEdit={canEdit} left={MAX_ATTACHMENTS_PER_RECORD - rec.attachments.length} />

      {!isVoid && (
        <section className={`${cardClass} space-y-3 p-4 sm:p-5`} data-testid="record-actions">
          <h2 className="text-[17px] font-semibold">{t("detail.actions")}</h2>
          <div className="flex flex-wrap items-start gap-3">
            {r.authorId !== me.id && (
              <ActionForm action={markRecordRead} hidden={{ id: r.id }} submitLabel={iRead ? t("detail.readAgain") : t("detail.markRead")} submitTone={iRead ? "secondary" : "primary"} testId="mark-read-form" />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {!r.caseId && (
              <ActionForm action={createCaseFromRecord} hidden={{ recordId: r.id }} submitLabel={t("detail.createCase")} submitTone="secondary" redirectTo="/records/cases/{id}" className="space-y-2" testId="create-case-form">
                <label htmlFor="cc-cat" className={labelClass}>{t("cases.category")}</label>
                <select id="cc-cat" name="category" className={inputClass}>{CASE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</select>
              </ActionForm>
            )}
            <ActionForm action={addRecordToTimeline} hidden={{ recordId: r.id }} submitLabel={t("detail.addToTimeline")} submitTone="secondary" redirectTo="/records/cases/{id}" className="space-y-2" testId="to-timeline-form">
              <label htmlFor="tl-case" className={labelClass}>{t("detail.timelineCase")}</label>
              <select id="tl-case" name="caseId" defaultValue={r.caseId ?? "new"} className={inputClass}>
                <option value="new">{t("detail.newCase")}</option>
                {cases.map((c) => <option key={c.id} value={c.id}>{c.code} {c.title}</option>)}
              </select>
            </ActionForm>
          </div>
          {canEdit && (
            <details className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-rose-900">{t("detail.void")}</summary>
              <ActionForm action={voidRecord} hidden={{ id: r.id }} submitLabel={t("detail.voidConfirm")} submitTone="danger" className="mt-2 space-y-2" testId="void-form">
                <p className="text-sm text-rose-900">{t("detail.voidWarning")}</p>
                <label htmlFor="void-reason" className={labelClass}>{t("detail.voidReason")} *</label>
                <textarea id="void-reason" name="reason" required rows={2} lang="ja" maxLength={1000} className={`${inputClass} min-h-16 py-2`} />
              </ActionForm>
            </details>
          )}
        </section>
      )}

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="fu-title" data-testid="record-followups">
        <h2 id="fu-title" className="text-[17px] font-semibold">{t("tasks.title")}</h2>
        <FollowupList items={rec.followups.map((x) => ({ ...x.f, assigneeName: x.assigneeName }))} me={me} today={today} />
        {!isVoid && <AddFollowupForm parent={{ recordId: r.id }} staff={staff} meId={me.id} />}
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="rd-title" data-testid="read-by">
        <h2 id="rd-title" className="text-[17px] font-semibold">{t("detail.readBy")}</h2>
        {rec.reads.length === 0 && pendingRecipients.length === 0 ? <p className="mt-2 text-sm text-ink-2">{t("detail.noReaders")}</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {rec.reads.map((x) => (
              <li key={x.userId} data-testid="reader">{x.name}: {dateTimeIn(x.readAt, locale, tz)}{x.versionNoRead < r.versionNo && <> <Badge tone="warn">{t("badge.updatedSinceRead")}</Badge></>}</li>
            ))}
            {pendingRecipients.map((x) => <li key={x.id} data-testid="reader-pending">{x.name}: <Badge tone="warn">{t("detail.notRead")}</Badge></li>)}
          </ul>
        )}
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="hist-title">
        <h2 id="hist-title" className="mb-3 text-[17px] font-semibold">{t("history.title")}</h2>
        <RevisionHistory revisions={rec.revisions} current={current} fields={fields} names={names} tz={tz} />
      </section>
    </div>
  );
}
