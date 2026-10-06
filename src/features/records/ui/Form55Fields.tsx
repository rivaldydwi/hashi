"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { inputClass, labelClass } from "@/components/styles";
import { FORM55_GROUPS, FORM55_LIMITS, f55Name, type Form55, type Form55Response } from "@/db/form55";

type Props = {
  defaults: Form55 | null;
  method: string | null;
  responderRole: string | null;
  responderTitle: string | null;
  today: string;
  /** Tanggal wawancara bawaan untuk "作成年月日" (sama dengan tanggal wawancara bila belum diisi). */
  interviewDate: string | null;
  disabled?: boolean;
};

const area = `${inputClass} min-h-20 py-2`;
const radio = "inline-flex min-h-11 items-center gap-2 text-sm";

/**
 * Isian form 参考様式第5-5号 (T-009): cara wawancara, jabatan 対応者, 18 butir (有/無 + isi), ⑥ 基準不適合等 dan bagian 4 (hanya bila 有), ⑦, 作成年月日.
 * Semua input tak terkendali (nama dari `f55Name`); state klien hanya untuk menampilkan kolom isi per butir dan bagian 4. Nama ke server = `form55FromFields`.
 * Butir dan label dari `src/db/form55.ts` (id: terjemahan + rujukan Jepang kecil; ja: Jepang saja).
 */
export function Form55Fields({ defaults, method, responderRole, responderTitle, today, interviewDate, disabled }: Props) {
  const t = useTranslations("records.form55");
  const locale = useLocale();
  const [answers, setAnswers] = useState<Record<string, "ok" | "problem" | undefined>>(() => Object.fromEntries(Object.entries(defaults?.items ?? {}).map(([k, v]) => [k, v.a])));
  const [nc, setNc] = useState<"yes" | "no" | "">(defaults?.nonconformity === true ? "yes" : defaults?.nonconformity === false ? "no" : "");
  const r: Form55Response | null = defaults?.response ?? null;
  const field = (id: string, label: string, el: React.ReactNode) => <div className="space-y-1.5"><label htmlFor={id} className={labelClass}>{label}</label>{el}</div>;
  const opt = (name: string, value: string, label: string, checked: boolean, testId?: string) => (
    <label className={radio}><input type="radio" name={name} value={value} defaultChecked={checked} disabled={disabled} className="h-5 w-5" data-testid={testId} />{label}</label>
  );
  const done = (name: string, cur: string | null | undefined) => (
    <div className="flex flex-wrap gap-4">
      {opt(name, "done", t("done"), cur === "done", `${name}-done`)}
      {opt(name, "not_done", t("notDone"), cur === "not_done", `${name}-not_done`)}
    </div>
  );

  return (
    <div className="space-y-6" data-testid="form55-fields">
      <p className="text-sm text-ink-2">{t("intro")}</p>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[15px] font-semibold">{t("s1")}</legend>
        <div className="flex flex-wrap items-center gap-x-4">
          <span className={labelClass}>{t("method")}</span>
          {opt("method", "in_person", t("inPerson"), method === "in_person", "method-in_person")}
          {opt("method", "online", t("online"), method === "online", "method-online")}
          {opt("method", "", t("methodNone"), !method)}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[15px] font-semibold">{t("s2")}</legend>
        <p className="text-xs text-ink-2">{t("responderHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("responderRole", t("role"), (
            <select id="responderRole" name="responderRole" defaultValue={responderRole ?? ""} disabled={disabled} className={inputClass} data-testid="responder-role">
              <option value="">{t("roleNone")}</option>
              <option value="support_manager">{t("supportManager")}</option>
              <option value="support_staff">{t("supportStaff")}</option>
            </select>
          ))}
          {field("responderTitle", t("positionTitle"), <input id="responderTitle" name="responderTitle" defaultValue={responderTitle ?? ""} maxLength={100} lang="ja" disabled={disabled} className={inputClass} data-testid="responder-title" />)}
        </div>
      </fieldset>

      <section className="space-y-4" aria-labelledby="f55-s3">
        <h4 id="f55-s3" className="text-[15px] font-semibold">{t("s3")}</h4>
        {FORM55_GROUPS.map((g) => (
          <fieldset key={g.key} className="space-y-2 rounded-xl border border-line p-3" data-testid={`f55-group-${g.key}`}>
            <legend className="px-1 text-sm font-semibold">{g.no} {locale === "ja" ? g.ja : g.id}</legend>
            {g.items.map((it, i) => {
              const cur = defaults?.items[it.code];
              const a = answers[it.code];
              return (
                <div key={it.code} className="space-y-1.5 border-t border-line pt-2 first:border-0 first:pt-0" data-testid={`f55-item-${it.code}`}>
                  <p className="text-sm"><span className="font-medium">({i + 1})</span> {locale === "ja" ? it.ja : it.id}{locale !== "ja" && <span lang="ja" className="ml-2 text-xs text-ink-2">{it.ja}</span>}</p>
                  <div className="flex flex-wrap items-center gap-x-4" role="radiogroup" aria-label={locale === "ja" ? it.ja : it.id}>
                    <label className={radio}><input type="radio" name={f55Name.answer(it.code)} value="ok" checked={a === "ok"} onChange={() => setAnswers((s) => ({ ...s, [it.code]: "ok" }))} disabled={disabled} className="h-5 w-5" data-testid={`${it.code}-ok`} />{t("ok")}</label>
                    <label className={radio}><input type="radio" name={f55Name.answer(it.code)} value="problem" checked={a === "problem"} onChange={() => setAnswers((s) => ({ ...s, [it.code]: "problem" }))} disabled={disabled} className="h-5 w-5" data-testid={`${it.code}-problem`} />{t("problem")}</label>
                    {a && <button type="button" onClick={() => setAnswers((s) => ({ ...s, [it.code]: undefined }))} disabled={disabled} className="min-h-11 px-2 text-xs text-ink-2 underline">{t("clear")}</button>}
                  </div>
                  {a === "problem" && (
                    <div className="space-y-1">
                      <label htmlFor={`t-${it.code}`} className={labelClass}>{t("problemText")} *</label>
                      <textarea id={`t-${it.code}`} name={f55Name.text(it.code)} defaultValue={cur?.text ?? ""} lang="ja" rows={2} maxLength={FORM55_LIMITS.item} required disabled={disabled} className={area} data-testid={`${it.code}-text`} />
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}

        <fieldset className="space-y-1 rounded-xl border border-line p-3" data-testid="f55-nonconformity">
          <legend className="px-1 text-sm font-semibold">{t("nonconformity")}</legend>
          <div className="flex flex-wrap gap-4">
            <label className={radio}><input type="radio" name={f55Name.nonconformity} value="yes" checked={nc === "yes"} onChange={() => setNc("yes")} disabled={disabled} className="h-5 w-5" data-testid="nc-yes" />{t("yes")}</label>
            <label className={radio}><input type="radio" name={f55Name.nonconformity} value="no" checked={nc === "no"} onChange={() => setNc("no")} disabled={disabled} className="h-5 w-5" data-testid="nc-no" />{t("no")}</label>
            {nc && <button type="button" onClick={() => setNc("")} disabled={disabled} className="min-h-11 px-2 text-xs text-ink-2 underline">{t("clear")}</button>}
          </div>
        </fieldset>
        {field("f55-special", t("special"), <textarea id="f55-special" name={f55Name.special} defaultValue={defaults?.special ?? ""} lang="ja" rows={3} maxLength={FORM55_LIMITS.text} disabled={disabled} className={area} data-testid="f55-special" />)}
      </section>

      {nc === "yes" && (
        <section className="space-y-4 rounded-xl border border-amber-300 bg-amber-50/40 p-3 sm:p-4" aria-labelledby="f55-s4" data-testid="f55-response">
          <h4 id="f55-s4" className="text-[15px] font-semibold">{t("s4")}</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("f55-occ", `${t("occurredOn")} *`, <input id="f55-occ" type="date" max={today} name={f55Name.occurredOn} defaultValue={r?.occurredOn ?? ""} required disabled={disabled} className={inputClass} data-testid="r-occurredOn" />)}
          </div>
          {field("f55-rc", `${t("content")} *`, <textarea id="f55-rc" name={f55Name.content} defaultValue={r?.content ?? ""} lang="ja" rows={3} maxLength={FORM55_LIMITS.text} required disabled={disabled} className={area} data-testid="r-content" />)}

          <fieldset className="space-y-2"><legend className="text-sm font-semibold">{t("toWorker")}</legend>
            <div className="flex flex-wrap gap-4">
              {opt(f55Name.workerKind, "referred", t("referred"), r?.worker.kind === "referred", "r-worker-referred")}
              {opt(f55Name.workerKind, "none", t("none"), r?.worker.kind === "none", "r-worker-none")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field("f55-wb", t("workerBody"), <input id="f55-wb" name={f55Name.workerBody} defaultValue={r?.worker.body ?? ""} lang="ja" maxLength={FORM55_LIMITS.short} disabled={disabled} className={inputClass} />)}
              {field("f55-wr", t("reason"), <input id="f55-wr" name={f55Name.workerReason} defaultValue={r?.worker.reason ?? ""} lang="ja" maxLength={FORM55_LIMITS.text} disabled={disabled} className={inputClass} />)}
            </div>
          </fieldset>

          <fieldset className="space-y-2"><legend className="text-sm font-semibold">{t("toCompany")}</legend>
            <p className="text-sm">{t("notified")}</p>
            {done(f55Name.notified, r?.company.notified)}
            <div className="grid gap-3 sm:grid-cols-3">
              {field("f55-no", t("date"), <input id="f55-no" type="date" max={today} name={f55Name.notifiedOn} defaultValue={r?.company.notifiedOn ?? ""} disabled={disabled} className={inputClass} />)}
              {field("f55-nt", t("notifiedTo"), <input id="f55-nt" name={f55Name.notifiedTo} defaultValue={r?.company.notifiedTo ?? ""} lang="ja" maxLength={FORM55_LIMITS.short} disabled={disabled} className={inputClass} />)}
              {field("f55-nr", t("reason"), <input id="f55-nr" name={f55Name.notifiedReason} defaultValue={r?.company.notifiedReason ?? ""} lang="ja" maxLength={FORM55_LIMITS.text} disabled={disabled} className={inputClass} />)}
            </div>
            <p className="text-sm">{t("immigration")}</p>
            {done(f55Name.immigration, r?.company.immigration)}
            {field("f55-in", t("immigrationNote"), <input id="f55-in" name={f55Name.immigrationNote} defaultValue={r?.company.immigrationNote ?? ""} lang="ja" maxLength={FORM55_LIMITS.text} disabled={disabled} className={inputClass} />)}
          </fieldset>

          <fieldset className="space-y-2"><legend className="text-sm font-semibold">{t("toAgency")}</legend>
            {done(f55Name.reported, r?.agency.reported)}
            <div className="grid gap-3 sm:grid-cols-3">
              {field("f55-ro", t("date"), <input id="f55-ro" type="date" max={today} name={f55Name.reportedOn} defaultValue={r?.agency.on ?? ""} disabled={disabled} className={inputClass} />)}
              {field("f55-rb", t("agencyBody"), <input id="f55-rb" name={f55Name.reportedBody} defaultValue={r?.agency.body ?? ""} lang="ja" maxLength={FORM55_LIMITS.short} disabled={disabled} className={inputClass} />)}
              {field("f55-rr", t("reason"), <input id="f55-rr" name={f55Name.reportedReason} defaultValue={r?.agency.reason ?? ""} lang="ja" maxLength={FORM55_LIMITS.text} disabled={disabled} className={inputClass} />)}
            </div>
          </fieldset>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("f55-created", t("createdOn"), <input id="f55-created" type="date" max={today} name={f55Name.createdOn} defaultValue={defaults?.createdOn ?? ""} disabled={disabled} className={inputClass} data-testid="f55-createdOn" />)}
        <p className="self-end text-xs text-ink-2">{t("createdOnHint", { date: interviewDate ? interviewDate.replace(/-/g, "/") : "—" })}</p>
      </div>
    </div>
  );
}
