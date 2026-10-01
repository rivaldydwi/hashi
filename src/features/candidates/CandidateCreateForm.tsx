"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { btnDanger, btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { checkFileSize } from "@/features/documents/DocumentForms";
import { idle, type FormState } from "@/lib/form-state";
import { addCandidate } from "./actions";
import { FieldInputs } from "./DetailForms";
import { LIST_SECTIONS, SINGLE_SECTIONS, toFormValue, type FieldDef } from "./sections";

const emptyValues = (fields: FieldDef[]) => Object.fromEntries(fields.map((f) => [f.name, toFormValue(f, undefined)]));

/**
 * Form tambah kandidat LENGKAP dalam satu halaman, diturunkan dari sections.ts (tidak ada definisi kolom ganda).
 * Satu tombol Simpan; yang wajib hanya nama, jenis kelamin, tanggal lahir, dan bidang.
 *
 * Isian tidak hilang saat ada error: form dikirim lewat onSubmit manual (bukan atribut `action`), karena React
 * mengosongkan form uncontrolled setelah sebuah form-action selesai. Dengan cara ini input, pilihan, baris
 * berulang, dan berkas yang sudah dipilih tetap utuh; server hanya menambahkan penanda kolom yang tidak valid.
 */
export function CandidateCreateForm({ fieldSuggestions, maxDate }: { fieldSuggestions: string[]; maxDate: string }) {
  const t = useTranslations("candidates");
  const tAll = useTranslations(); // pesan error datang sebagai kunci lengkap (mis. "candidates.errors.invalid")
  const tf = useTranslations("candidates.form");
  const tc = useTranslations("common");
  const td = useTranslations("detail.sections");
  const tdocs = useTranslations("detail.documents");
  const ts = useTranslations("detail.sharing");
  const [state, formAction, pending] = useActionState<FormState, FormData>(addCandidate, idle);
  const [share, setShare] = useState(false);
  const [rows, setRows] = useState<Record<string, number[]>>(() => Object.fromEntries(LIST_SECTIONS.map((s) => [s.key, []])));
  const nextKey = useRef(1);
  const fieldErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  // Setelah error validasi: gulir ke isian pertama yang ditandai
  useEffect(() => {
    if (state.status === "error") {
      document.querySelector("[data-invalid]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state]);

  const addRow = (key: string) => setRows((r) => ({ ...r, [key]: [...r[key], nextKey.current++] }));
  const removeRow = (key: string, rowKey: number) => setRows((r) => ({ ...r, [key]: r[key].filter((k) => k !== rowKey) }));

  // Ringkasan bagian yang perlu diperiksa (judul bagian + nomor baris saat ini)
  const problems: string[] = Object.keys(fieldErrors).map((k) => {
    if (k === "extras") return tf("extrasTitle");
    const [section, rowKey] = k.split(".");
    const title = td(`${section}.title`);
    return rowKey ? `${title} (${tf("rowN", { n: (rows[section]?.indexOf(Number(rowKey)) ?? 0) + 1 })})` : title;
  });

  return (
    <form
      noValidate={false}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="space-y-4 pb-24"
      data-testid="candidate-create-form"
    >
      {state.status === "error" && (
        <div role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800" data-testid="form-error">
          <p className="font-medium">{tAll(state.key)}</p>
          {problems.length > 0 && state.key === "candidates.errors.invalid" && (
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-sm text-stone-500">{tf("legend")}</p>

      {SINGLE_SECTIONS.map((s) => (
        <section key={s.key} className={`${cardClass} p-4 sm:p-5`} data-testid={`create-section-${s.key}`} data-invalid={fieldErrors[s.key] ? true : undefined}>
          <h2 className="mb-3 font-medium">{td(`${s.key}.title`)}</h2>
          <FieldInputs
            section={s.key}
            fields={s.fields}
            values={emptyValues(s.fields)}
            invalid={fieldErrors[s.key]}
            suggestions={s.key === "basic" ? { field: fieldSuggestions } : {}}
            dateMax={s.key === "basic" ? { birthDate: maxDate } : {}}
          />
        </section>
      ))}

      {LIST_SECTIONS.map((s) => (
        <section key={s.key} className={`${cardClass} p-4 sm:p-5`} data-testid={`create-section-${s.key}`}>
          <h2 className="mb-3 font-medium">{td(`${s.key}.title`)}</h2>
          {rows[s.key].length === 0 && <p className="mb-3 text-sm text-stone-500">{tf("noRows")}</p>}
          <div className="space-y-3">
            {rows[s.key].map((rowKey, i) => (
              <div
                key={rowKey}
                className="rounded-lg border border-stone-200 bg-stone-50/50 p-3"
                data-testid={`create-row-${s.key}`}
                data-invalid={fieldErrors[`${s.key}.${rowKey}`] ? true : undefined}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-700">{tf("rowN", { n: i + 1 })}</span>
                  <button type="button" onClick={() => removeRow(s.key, rowKey)} className={`${btnDanger} !px-3 !py-1.5 text-xs`}>
                    {tf("removeRow")}
                  </button>
                </div>
                <FieldInputs
                  section={s.key}
                  fields={s.fields}
                  values={emptyValues(s.fields)}
                  idPrefix={`${s.key}-${rowKey}`}
                  namePrefix={`${s.key}.${rowKey}.`}
                  invalid={fieldErrors[`${s.key}.${rowKey}`]}
                />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addRow(s.key)} className={`${btnSecondary} mt-3`} data-testid={`add-row-${s.key}`}>
            + {tf("addRow")}
          </button>
        </section>
      ))}

      <section className={`${cardClass} space-y-4 p-4 sm:p-5`} data-testid="create-section-extras" data-invalid={fieldErrors.extras ? true : undefined}>
        <h2 className="font-medium">{tf("extrasTitle")}</h2>
        <fieldset className="space-y-2 rounded-lg border border-stone-200 p-3" data-testid="share-fieldset">
          <legend className="px-1 text-sm font-medium text-stone-700">{t("shareTitle")}</legend>
          <label className="flex items-start gap-2 py-1 text-sm">
            <input type="checkbox" name="shareWithTsk" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-stone-300" data-testid="share-checkbox" />
            <span>{t("shareLabel")}</span>
          </label>
          <p className="text-xs text-stone-500">{t("shareHint")}</p>
          {share && (
            <label className="flex items-start gap-2 py-1 text-sm text-stone-800">
              <input type="checkbox" name="shareConfirm" required className="mt-0.5 h-5 w-5 rounded border-stone-300" data-testid="share-confirm" />
              <span>{ts("confirmLabel")}</span>
            </label>
          )}
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="dataConsentDate" className={labelClass}>{t("consentDate")}</label>
          <input id="dataConsentDate" name="dataConsentDate" type="date" max={maxDate} className={inputClass} />
          <p className="text-xs text-stone-500">{t("consentHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="consentForm" className={labelClass}>{t("consentForm")}</label>
          <input
            id="consentForm"
            name="consentForm"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => checkFileSize(e.currentTarget, tdocs("errors.tooBig"))}
            className={inputClass}
          />
          <p className="text-xs text-stone-500">{t("consentFormHint")}</p>
        </div>
      </section>

      {/* Bilah simpan menempel di bawah layar supaya tombolnya selalu terjangkau di form yang panjang (terutama ponsel) */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur" data-testid="save-bar">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <button type="submit" disabled={pending} className={`${btnPrimary} flex-1 sm:flex-none`} data-testid="save-candidate">
            {pending ? tc("saving") : tf("save")}
          </button>
          <Link href="/candidates" className={btnSecondary}>{tc("cancel")}</Link>
        </div>
      </div>
    </form>
  );
}
