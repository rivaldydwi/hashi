"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/FormBits";
import { btnDanger, btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { useToast } from "@/components/Toast";
import { COUNTERPARTIES, MEETING_METHODS, SECTION_KEYS, WORK_TYPES, type MeetingSections } from "@/db/records-core";
import { idle, type FormState } from "@/lib/form-state";
import { saveRecord, uploadAttachment } from "../actions";
import { StaffPicker, WorkerPicker, type PickStaff, type PickWorker } from "./Pickers";

export type RecordInitial = {
  id?: string; recordDate: string; authorId: string; subjects: string[]; clientSiteId: string; caseId: string; recipients: string[];
  workType: string; workTypeOther: string; actionTaken: string; result: string; pending: string; nextAction: string; reportToText: string; note: string;
  meetingSubject: string; startedAt: string; endedAt: string; method: string; counterparty: string; clientCompanyId: string; handlers: string[]; sections: MeetingSections;
};

type TimelineDraft = { date: string; time: string; event: string; subjectStatement: string; companyResponse: string; note: string };
type PhotoDraft = { file: File; caption: string; includeInPdf: boolean };

const area = `${inputClass} min-h-24 py-2`;

/**
 * Form ① (業務記録) dan ② (議事録・面談記録), mobile-first. Dikirim lewat onSubmit manual (isian tidak hilang saat error). Foto dipilih di form ini dan
 * diunggah SETELAH catatan tersimpan (butuh id catatan). Peringatan beforeunload bila ada perubahan belum tersimpan; tanpa draf di peramban.
 */
export function RecordForm({
  kind, me, staff, workers, sites, companies, cases, roleLabels, initial, photosLeft, autoFilled = [], continuesRecordId,
}: {
  kind: "daily_work" | "meeting"; me: { id: string; role: string }; staff: PickStaff[]; workers: PickWorker[]; sites: Array<{ id: string; label: string }>; companies: Array<{ id: string; name: string }>;
  cases: Array<{ id: string; label: string }>; roleLabels: Record<string, string>; initial: RecordInitial; photosLeft: number;
  /** Kolom yang nilai awalnya diisi otomatis (mis. dari "Lanjutkan"): subjects | site | case. Ditandai "Diisi otomatis, periksa". */
  autoFilled?: Array<"subjects" | "site" | "case">; continuesRecordId?: string;
}) {
  const t = useTranslations("records");
  const tc = useTranslations("common");
  const tAll = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(saveRecord, idle);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [workType, setWorkType] = useState(initial.workType || "interview");
  const [caseId, setCaseId] = useState(initial.caseId);
  const [sections, setSections] = useState<MeetingSections>(initial.sections);
  const [timeline, setTimeline] = useState<TimelineDraft[]>([]);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const editing = Boolean(initial.id);
  const isAdmin = me.role === "TSK_ADMIN";
  const auto = (k: "subjects" | "site" | "case") => autoFilled.includes(k) && <p className="text-xs text-accent-text" data-testid={`autofilled-${k}`}>{tAll("candidates.form.autoFilled")}</p>;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (state.status !== "success" || !state.id) return;
    const id = state.id;
    (async () => {
      setUploading(true);
      let failed = 0;
      for (const p of photos) {
        const fd = new FormData();
        fd.set("recordId", id); fd.set("file", p.file); fd.set("caption", p.caption);
        if (p.includeInPdf) fd.set("includeInPdf", "on");
        const res = await uploadAttachment(idle, fd);
        if (res.status === "error") { failed++; toast(tAll(res.key), "error"); }
      }
      setDirty(false);
      toast(tAll(state.key));
      router.push(failed ? `/records/${id}?photoFailed=${failed}` : `/records/${id}`);
    })();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSection = (k: string, items: string[]) => setSections((s) => ({ ...s, [k]: items }));
  const busy = pending || uploading;

  return (
    <form
      ref={formRef}
      data-testid={`record-form-${kind}`}
      className="space-y-5"
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.delete("photoPicker");
        data.set("kind", kind);
        data.set("sections", JSON.stringify(sections));
        data.set("timeline", JSON.stringify(timeline));
        startTransition(() => action(data));
      }}
    >
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {continuesRecordId && <input type="hidden" name="continuesRecordId" value={continuesRecordId} />}

      <section className={`${cardClass} space-y-4 p-4 sm:p-5`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="recordDate" className={labelClass}>{t("f.date")} *</label>
            <input id="recordDate" name="recordDate" type="date" required defaultValue={initial.recordDate} max={initial.recordDate > "" ? undefined : undefined} className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="authorId" className={labelClass}>{t("f.author")}</label>
            <select id="authorId" name="authorId" defaultValue={initial.authorId} disabled={!isAdmin} className={inputClass}>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {!isAdmin && <input type="hidden" name="authorId" value={initial.authorId} />}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className={labelClass}>{t("f.subjects")}</span>
          <WorkerPicker workers={workers} selected={initial.subjects} />
          {auto("subjects")}
          {kind === "meeting" && <p className="text-xs text-ink-2">{t("f.subjectsOptional")}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="clientSiteId" className={labelClass}>{t("f.site")}</label>
            <select id="clientSiteId" name="clientSiteId" defaultValue={initial.clientSiteId} className={inputClass}>
              <option value="">{t("f.siteAuto")}</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {auto("site")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="caseId" className={labelClass}>{t("f.case")}</label>
            <select id="caseId" name="caseId" value={caseId} onChange={(e) => setCaseId(e.target.value)} className={inputClass}>
              <option value="">{t("f.noCase")}</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {auto("case")}
          </div>
        </div>
      </section>

      {kind === "daily_work" ? (
        <section className={`${cardClass} space-y-4 p-4 sm:p-5`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="workType" className={labelClass}>{t("f.workType")} *</label>
              <select id="workType" name="workType" value={workType} onChange={(e) => setWorkType(e.target.value)} className={inputClass}>
                {WORK_TYPES.map((w) => <option key={w} value={w}>{t(`workTypes.${w}`)}</option>)}
              </select>
            </div>
            {workType === "other" && (
              <div className="space-y-1.5">
                <label htmlFor="workTypeOther" className={labelClass}>{t("f.workTypeOther")} *</label>
                <input id="workTypeOther" name="workTypeOther" defaultValue={initial.workTypeOther} maxLength={200} className={inputClass} />
              </div>
            )}
          </div>
          {([["actionTaken", initial.actionTaken], ["result", initial.result], ["pending", initial.pending], ["nextAction", initial.nextAction]] as const).map(([k, v]) => (
            <div key={k} className="space-y-1.5">
              <label htmlFor={k} className={labelClass}>{t(`f.${k}`)}</label>
              <textarea id={k} name={k} defaultValue={v} lang="ja" rows={3} maxLength={4000} className={area} />
            </div>
          ))}
          <StaffPicker staff={staff.filter((s) => s.id !== me.id)} selected={initial.recipients} name="recipients" legend={t("f.reportToApp")} roleLabels={roleLabels} />
          <div className="space-y-1.5">
            <label htmlFor="reportToText" className={labelClass}>{t("f.reportToText")}</label>
            <input id="reportToText" name="reportToText" defaultValue={initial.reportToText} maxLength={500} lang="ja" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="note" className={labelClass}>{t("f.note")}</label>
            <textarea id="note" name="note" defaultValue={initial.note} lang="ja" rows={2} maxLength={4000} className={area} />
          </div>
        </section>
      ) : (
        <>
          <section className={`${cardClass} space-y-4 p-4 sm:p-5`}>
            <div className="space-y-1.5">
              <label htmlFor="meetingSubject" className={labelClass}>{t("f.meetingSubject")} *</label>
              <input id="meetingSubject" name="meetingSubject" required defaultValue={initial.meetingSubject} lang="ja" maxLength={300} className={inputClass} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="startedAt" className={labelClass}>{t("f.startedAt")} *</label>
                <input id="startedAt" name="startedAt" type="datetime-local" required defaultValue={initial.startedAt} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="endedAt" className={labelClass}>{t("f.endedAt")}</label>
                <input id="endedAt" name="endedAt" type="datetime-local" defaultValue={initial.endedAt} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="method" className={labelClass}>{t("f.placeMethod")}</label>
                <select id="method" name="method" defaultValue={initial.method} className={inputClass}>
                  <option value="">—</option>
                  {MEETING_METHODS.map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="counterparty" className={labelClass}>{t("f.counterparty")}</label>
                <select id="counterparty" name="counterparty" defaultValue={initial.counterparty || "client"} className={inputClass}>
                  {COUNTERPARTIES.map((c) => <option key={c} value={c}>{t(`counterparties.${c}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="clientCompanyId" className={labelClass}>{t("f.company")}</label>
                <select id="clientCompanyId" name="clientCompanyId" defaultValue={initial.clientCompanyId} className={inputClass}>
                  <option value="">—</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <StaffPicker staff={staff} selected={initial.handlers.length ? initial.handlers : [me.id]} name="handlers" legend={t("f.handlers")} roleLabels={roleLabels} />
          </section>

          <section className={`${cardClass} space-y-4 p-4 sm:p-5`} data-testid="sections-editor">
            <p className="text-sm text-ink-2">{t("f.sectionsHint")}</p>
            {SECTION_KEYS.map((k, i) => {
              const items = sections[k] ?? [];
              return (
                <fieldset key={k} className="space-y-2" data-testid={`section-${k}`}>
                  <legend className="mb-1 text-[13px] font-medium text-ink-menu">{i + 1}. {t(`sections.${k}`)}</legend>
                  {items.map((item, idx) => (
                    <div key={idx} className="flex gap-2">
                      <label className="sr-only" htmlFor={`${k}-${idx}`}>{t(`sections.${k}`)} {idx + 1}</label>
                      <textarea id={`${k}-${idx}`} value={item} lang="ja" rows={2} maxLength={2000} onChange={(e) => setSection(k, items.map((x, j) => (j === idx ? e.target.value : x)))} className={`${area} min-h-16 flex-1`} />
                      <button type="button" onClick={() => setSection(k, items.filter((_, j) => j !== idx))} aria-label={t("f.removePoint")} className={`${btnSecondary} !px-3`}>×</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setSection(k, [...items, ""])} className={btnSecondary} data-testid={`add-point-${k}`}>+ {t("f.addPoint")}</button>
                </fieldset>
              );
            })}
          </section>

          {caseId && (
            <section className={`${cardClass} space-y-3 p-4 sm:p-5`} data-testid="timeline-editor">
              <h2 className="text-[17px] font-semibold">{t("f.timelineTitle")}</h2>
              <p className="text-sm text-ink-2">{t("f.timelineHint")}</p>
              {timeline.map((r, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-line-btn p-3" data-testid="timeline-draft">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input aria-label={t("f.date")} type="date" value={r.date} onChange={(e) => setTimeline((x) => x.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} className={inputClass} data-testid="tl-date" />
                    <input aria-label={t("f.time")} type="time" value={r.time} onChange={(e) => setTimeline((x) => x.map((y, j) => (j === i ? { ...y, time: e.target.value } : y)))} className={inputClass} />
                  </div>
                  {(["event", "subjectStatement", "companyResponse", "note"] as const).map((k) => (
                    <textarea key={k} aria-label={t(`f.tl_${k}`)} placeholder={t(`f.tl_${k}`)} value={r[k]} lang="ja" rows={2} onChange={(e) => setTimeline((x) => x.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))} className={area} data-testid={`tl-${k}`} />
                  ))}
                  <button type="button" onClick={() => setTimeline((x) => x.filter((_, j) => j !== i))} className={btnDanger}>{t("f.removePoint")}</button>
                </div>
              ))}
              <button type="button" onClick={() => setTimeline((x) => [...x, { date: initial.recordDate, time: "", event: "", subjectStatement: "", companyResponse: "", note: "" }])} className={btnSecondary} data-testid="add-timeline-row">+ {t("f.addTimelineRow")}</button>
            </section>
          )}
        </>
      )}

      <section className={`${cardClass} space-y-3 p-4 sm:p-5`}>
        <h2 className="text-[17px] font-semibold">{t("f.photos")}</h2>
        <p className="text-xs text-ink-2">{t("f.photosHint", { n: photosLeft })}</p>
        <label className={`${btnSecondary} cursor-pointer`}>
          {t("f.addPhoto")}
          <input
            name="photoPicker" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" data-testid="photo-input"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].slice(0, Math.max(0, photosLeft - photos.length));
              setPhotos((p) => [...p, ...files.map((file) => ({ file, caption: "", includeInPdf: false }))]);
              e.target.value = "";
              setDirty(true);
            }}
          />
        </label>
        <ul className="space-y-2">
          {photos.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line-btn p-2" data-testid="photo-draft">
              <span className="min-w-0 flex-1 truncate text-sm">{p.file.name}</span>
              <input aria-label={t("f.caption")} placeholder={t("f.caption")} value={p.caption} maxLength={300} lang="ja" onChange={(e) => setPhotos((x) => x.map((y, j) => (j === i ? { ...y, caption: e.target.value } : y)))} className={`${inputClass} sm:w-64`} />
              <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={p.includeInPdf} onChange={(e) => setPhotos((x) => x.map((y, j) => (j === i ? { ...y, includeInPdf: e.target.checked } : y)))} className="h-5 w-5" />{t("f.includeInPdf")}</label>
              <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className={btnSecondary}>{t("f.removePoint")}</button>
            </li>
          ))}
        </ul>
      </section>

      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="form-error">{tAll(state.key)}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} aria-busy={busy} className={btnPrimary} data-testid="save-record">
          {busy && <Spinner />}
          {busy ? tc("saving") : editing ? t("f.saveChanges") : t("f.save")}
        </button>
        <button type="button" className={btnSecondary} onClick={() => { if (!dirty || window.confirm(t("f.leaveConfirm"))) router.back(); }}>{tc("cancel")}</button>
      </div>
    </form>
  );
}
