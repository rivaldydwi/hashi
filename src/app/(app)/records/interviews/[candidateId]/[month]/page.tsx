import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { summarizeForm55, readForm55 } from "@/db/form55";
import { CASE_CATEGORIES, INTERVIEW_REASONS, INTERVIEW_RESULTS, MAX_ATTACHMENTS_PER_RECORD, fiscalYearOf } from "@/db/records-core";
import { responsibleOfWorker } from "@/db/responsibility-queries";
import { requireStaff } from "@/features/records/access";
import { createCaseFromInterview, savePeriodicInterview, voidPeriodicInterview } from "@/features/records/actions";
import { allWorkers, interviewDetail, listStaff } from "@/features/records/queries";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { Attachments } from "@/features/records/ui/Attachments";
import { AddFollowupForm, FollowupList } from "@/features/records/ui/Followups";
import { RevisionHistory, toSnake, type RevField } from "@/features/records/ui/RevisionHistory";
import { Badge } from "@/features/records/ui/common";
import { Form55Fields } from "@/features/records/ui/Form55Fields";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Satu sel wawancara berkala: isi/ubah wawancara (status, alasan, isi), foto, tindak lanjut, riwayat edit, pembatalan dengan alasan. */
export default async function InterviewFormPage({ params }: { params: Promise<{ candidateId: string; month: string }> }) {
  const me = await requireStaff();
  const { candidateId, month } = await params;
  if (!UUID.test(candidateId) || !/^\d{4}-\d{2}-01$/.test(month)) notFound();
  const t = await getTranslations("records");
  const locale = await getLocale();
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const data = await tenantQuery(async (tx) => ({ worker: (await allWorkers(tx)).find((w) => w.id === candidateId), detail: await interviewDetail(tx, candidateId, month), staff: await listStaff(tx), responsible: await responsibleOfWorker(tx, candidateId, today) }));
  if (!data.worker) notFound();
  const { worker: w, detail, staff, responsible } = data;
  const r = detail?.row;
  const names = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const fields: RevField[] = [{ key: "applicable", label: t("interviews.form.applicable"), kind: "bool" }, { key: "interview_date", label: t("interviews.form.date") }, { key: "result_status", label: t("interviews.form.status") }, { key: "reason", label: t("interviews.form.reason") }, { key: "content", label: t("interviews.form.content") }, { key: "staff_id", label: t("f.author") }, { key: "note", label: t("f.note") }, { key: "method", label: t("interviews.form.method") }, { key: "responder_role", label: t("form55.role") }, { key: "responder_title", label: t("form55.positionTitle") }, { key: "form55", label: t("form55.title"), kind: "form55" }, { key: "status", label: t("history.status") }, { key: "void_reason", label: t("history.voidReason") }];
  const monthLabel = `${month.slice(0, 4)}/${month.slice(5, 7)}`;
  // 対応者 bawaan = penanggung jawab efektif pekerja (T-010; per pekerja > perusahaan) bila masih staf aktif; boleh diganti per wawancara
  const defaultStaff = r?.staffId ?? (responsible?.staffId && staff.some((x) => x.id === responsible.staffId) ? responsible.staffId : me.id);
  const f55 = r ? readForm55(r.form55) : null;
  const f55sum = summarizeForm55(f55);
  const conducted = !!r && r.applicable && r.resultStatus !== null && r.resultStatus !== "not_done";
  const showFollow = r && ["follow_up", "issue"].includes(r.resultStatus ?? "");
  const area = `${inputClass} min-h-24 py-2`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/records/interviews" className={btnSecondary}>← {t("interviews.backToGrid")}</Link>
        <h2 className="text-[19px] font-semibold" data-testid="interview-title">{w.fullName} · {monthLabel}</h2>
        {r && <Badge testId="interview-state">{r.applicable ? (r.resultStatus ? t(`results.${r.resultStatus}`) : "") : t("interviews.state.na")}</Badge>}
        {r && r.versionNo > 1 && <Badge>{t("badge.version", { n: r.versionNo })}</Badge>}
      </div>

      <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="iw-title">
        <h3 id="iw-title" className="sr-only">{t("interviews.workerInfo")}</h3>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-ink-2">{t("interviews.col.field")}: </dt><dd className="inline">{(locale === "ja" ? w.fieldNameJa : w.fieldNameId) ?? "—"}</dd></div>
          <div><dt className="inline text-ink-2">{t("interviews.col.start")}: </dt><dd className="inline">{w.startDate.replace(/-/g, "/")}</dd></div>
          <div><dt className="inline text-ink-2">{t("interviews.col.company")}: </dt><dd className="inline">{w.companyName} / {w.siteName}</dd></div>
          <div><dt className="inline text-ink-2">{t("interviews.col.pic")}: </dt><dd className="inline">{w.contacts[0]?.name ?? "—"}</dd></div>
        </dl>
      </section>

      <section className={`${cardClass} p-4 sm:p-5`} data-testid="interview-form-card">
        <ActionForm action={savePeriodicInterview} hidden={{ candidateId, month }} submitLabel={r ? t("f.saveChanges") : t("f.save")} className="space-y-4" testId="interview-form">
          <fieldset className="space-y-1">
            <legend className="mb-1 text-[13px] font-medium text-ink-menu">{t("interviews.form.applicable")}</legend>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="applicable" value="yes" defaultChecked={!r || r.applicable} className="h-5 w-5" data-testid="applicable-yes" />{t("interviews.form.applicableYes")}</label>
              <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="applicable" value="no" defaultChecked={r ? !r.applicable : false} className="h-5 w-5" data-testid="applicable-no" />{t("interviews.form.applicableNo")}</label>
            </div>
            <p className="text-xs text-ink-2">{t("interviews.form.applicableHint")}</p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="interviewDate" className={labelClass}>{t("interviews.form.date")}</label><input id="interviewDate" name="interviewDate" type="date" max={today} defaultValue={r?.interviewDate ?? ""} className={inputClass} /></div>
            <div className="space-y-1.5"><label htmlFor="resultStatus" className={labelClass}>{t("interviews.form.status")}</label>
              <select id="resultStatus" name="resultStatus" defaultValue={r?.resultStatus ?? "no_issue"} className={inputClass}>{INTERVIEW_RESULTS.map((s) => <option key={s} value={s}>{t(`results.${s}`)}</option>)}</select></div>
            <div className="space-y-1.5"><label htmlFor="reason" className={labelClass}>{t("interviews.form.reason")}</label>
              <select id="reason" name="reason" defaultValue={r?.reason ?? ""} className={inputClass}><option value="">—</option>{INTERVIEW_REASONS.map((s) => <option key={s} value={s}>{t(`reasons.${s}`)}</option>)}</select></div>
            <div className="space-y-1.5"><label htmlFor="staffId" className={labelClass}>{t("f.author")}</label>
              <select id="staffId" name="staffId" defaultValue={defaultStaff} className={inputClass}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          </div>
          <div className="space-y-1.5"><label htmlFor="content" className={labelClass}>{t("interviews.form.content")}</label><textarea id="content" name="content" defaultValue={r?.content ?? ""} lang="ja" rows={5} maxLength={8000} className={area} /></div>
          <div className="space-y-1.5"><label htmlFor="note" className={labelClass}>{t("f.note")}</label><textarea id="note" name="note" defaultValue={r?.note ?? ""} lang="ja" rows={2} maxLength={4000} className={area} /></div>
        <section className="space-y-3 border-t border-line pt-4" aria-labelledby="f55-title" data-testid="form55-section">
            <h3 id="f55-title" className="text-[17px] font-semibold">{t("form55.title")}</h3>
            <p className="text-xs text-ink-2">{t("form55.ignoredHint")}</p>
            <Form55Fields defaults={f55} method={r?.method ?? null} responderRole={r?.responderRole ?? null} responderTitle={r?.responderTitle ?? null} today={today} />
          </section>
        </ActionForm>
        {conducted && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="form55-links">
            <a href={`/records/export/form55/${candidateId}/${month}`} className={btnSecondary} data-testid="form55-pdf">{t("form55.pdf")}</a>
            <Link href={`/records/workers/${candidateId}/annual?fy=${fiscalYearOf(month)}`} className={btnSecondary} data-testid="form55-annual-link">{t("annual.workerLink")}</Link>
            <Badge testId="form55-state">{f55sum.filled ? (f55sum.nonconformity ? t("form55.stateNonconformity") : t("form55.filled")) : t("form55.notFilled")}</Badge>
          </p>
        )}
      </section>

      {r && (
        <>
          <Attachments items={detail!.attachments} parent={{ interviewId: r.id }} canEdit left={MAX_ATTACHMENTS_PER_RECORD - detail!.attachments.length} />

          {showFollow && (
            <section className={`${cardClass} space-y-3 p-4 sm:p-5`} data-testid="interview-followup-actions">
              <h3 className="text-[17px] font-semibold">{t("interviews.followUpTitle")}</h3>
              <ActionForm action={createCaseFromInterview} hidden={{ interviewId: r.id }} submitLabel={t("interviews.createCase")} submitTone="secondary" redirectTo="/records/cases/{id}" className="space-y-2" testId="case-from-interview-form">
                <label htmlFor="ci-cat" className={labelClass}>{t("cases.category")}</label>
                <select id="ci-cat" name="category" className={inputClass}>{CASE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</select>
              </ActionForm>
            </section>
          )}

          <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="fu-title" data-testid="interview-followups">
            <h3 id="fu-title" className="text-[17px] font-semibold">{t("tasks.title")}</h3>
            <FollowupList items={detail!.followups.map((x) => ({ ...x.f, assigneeName: x.assigneeName }))} me={me} today={today} />
            <AddFollowupForm parent={{ interviewId: r.id }} staff={staff} meId={me.id} />
          </section>

          <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="ih-title">
            <h3 id="ih-title" className="mb-3 text-[17px] font-semibold">{t("history.title")}</h3>
            <RevisionHistory revisions={detail!.revisions} current={toSnake(r as unknown as Record<string, unknown>)} fields={fields} names={names} tz={tz} testId="interview-history" />
          </section>

          <details className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-rose-900">{t("interviews.void")}</summary>
            <ActionForm action={voidPeriodicInterview} hidden={{ id: r.id }} submitLabel={t("detail.voidConfirm")} submitTone="danger" redirectTo="/records/interviews" className="mt-2 space-y-2" testId="void-interview-form">
              <p className="text-sm text-rose-900">{t("detail.voidWarning")}</p>
              <label htmlFor="vi-reason" className={labelClass}>{t("detail.voidReason")} *</label>
              <textarea id="vi-reason" name="reason" required rows={2} lang="ja" maxLength={1000} className={`${inputClass} min-h-16 py-2`} />
            </ActionForm>
          </details>
        </>
      )}
    </div>
  );
}
