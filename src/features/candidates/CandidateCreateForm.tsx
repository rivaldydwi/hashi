"use client";

import Link from "next/link";
import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { btnDanger, btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { checkFileSize } from "@/features/documents/DocumentForms";
import { candidateCompleteness } from "@/db/completeness";
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
export function CandidateCreateForm({ maxDate }: { maxDate: string }) {
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
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [percent, setPercent] = useState(0);

  // Kelengkapan langsung dari isian (fungsi yang sama dengan dashboard/daftar: candidateCompleteness). Bagian berbaris banyak dihitung terisi bila ada baris yang diisi.
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const values: Record<string, unknown> = {};
    for (const s of SINGLE_SECTIONS) for (const f of s.fields) {
      const v = data.get(f.name);
      values[f.name] = typeof v === "string" && v.trim() !== "" ? (f.kind === "boolean" ? v === "true" : v) : null;
    }
    const counts = { family: 0, education: 0, work: 0, certificates: 0 } as Record<string, number>;
    for (const s of LIST_SECTIONS) {
      const filled = new Set<string>();
      for (const [k, v] of data.entries()) if (k.startsWith(`${s.key}.`) && typeof v === "string" && v.trim() !== "") filled.add(k.split(".")[1]);
      counts[s.key] = filled.size;
    }
    setPercent(candidateCompleteness({ candidate: values, priv: values, counts: counts as never }).percent);
  }, []);

  // Peringatan sebelum meninggalkan halaman dengan isian belum tersimpan. TIDAK ada draf di localStorage/sessionStorage (data pribadi calon pekerja tidak boleh tinggal di peramban).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Setelah error validasi: gulir ke isian pertama yang ditandai
  useEffect(() => {
    if (state.status === "error") {
      setDirty(true);
      document.querySelector("[data-invalid]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state]);

  const addRow = (key: string) => setRows((r) => ({ ...r, [key]: [...r[key], nextKey.current++] }));
  const removeRow = (key: string, rowKey: number) => setRows((r) => ({ ...r, [key]: r[key].filter((k) => k !== rowKey) }));

  // Ringkasan bagian yang perlu diperiksa (judul bagian + nomor baris saat ini)
  const problems: Array<{ text: string; href: string }> = Object.keys(fieldErrors).map((k) => {
    if (k === "extras") return { text: tf("extrasTitle"), href: "#sec-extras" };
    const [section, rowKey] = k.split(".");
    const title = td(`${section}.title`);
    return { text: rowKey ? `${title} (${tf("rowN", { n: (rows[section]?.indexOf(Number(rowKey)) ?? 0) + 1 })})` : title, href: `#sec-${section}` };
  });
  const navItems = [...SINGLE_SECTIONS.map((x) => x.key), ...LIST_SECTIONS.map((x) => x.key), "extras"].map((key) => ({ key, label: key === "extras" ? tf("extrasTitle") : td(`${key}.title`) }));

  return (
    <form
      noValidate={false}
      ref={formRef}
      onInput={() => { setDirty(true); recompute(); }}
      onChange={() => { setDirty(true); recompute(); }}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setDirty(false); // simpan berhasil = pindah halaman tanpa peringatan; bila gagal, state error mengaktifkannya lagi (efek di bawah)
        startTransition(() => formAction(data));
      }}
      className="space-y-4 pb-24"
      data-testid="candidate-create-form"
    >
      {state.status === "error" && (
        <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="form-error">
          <p className="font-medium">{tAll(state.key)}</p>
          {problems.length > 0 && state.key === "candidates.errors.invalid" && (
            <>
              <p className="mt-1">{tf("fixHint")}</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p.text}><a href={p.href} className="inline-flex min-h-11 items-center font-medium underline">{p.text}</a></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="text-sm text-ink-2">{tf("legend")}</p>

      {/* Navigasi bagian: menempel di bawah bilah atas, bisa digeser ke samping di ponsel */}
      <nav aria-label={tf("sectionNav")} className="min-[700px]:sticky top-[68px] z-10 -mx-4 overflow-x-auto border-b border-line bg-page/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6" data-testid="section-nav">
        <ul className="flex gap-2 whitespace-nowrap">
          {navItems.map((n) => (
            <li key={n.key}><a href={`#sec-${n.key}`} className="inline-flex min-h-11 items-center rounded-full border border-line-btn bg-card px-4 text-[13px] font-medium text-ink-menu hover:bg-hover">{n.label}</a></li>
          ))}
        </ul>
      </nav>

      {SINGLE_SECTIONS.map((s) => (
        <section key={s.key} id={`sec-${s.key}`} className={`${cardClass} scroll-mt-32 p-4 sm:p-5`} data-testid={`create-section-${s.key}`} data-invalid={fieldErrors[s.key] ? true : undefined}>
          <h2 className="mb-3 font-medium">{td(`${s.key}.title`)}</h2>
          <FieldInputs
            section={s.key}
            fields={s.fields}
            values={emptyValues(s.fields)}
            invalid={fieldErrors[s.key]}
            dateMax={s.key === "basic" ? { birthDate: maxDate } : {}}
          />
        </section>
      ))}

      {LIST_SECTIONS.map((s) => (
        <section key={s.key} id={`sec-${s.key}`} className={`${cardClass} scroll-mt-32 p-4 sm:p-5`} data-testid={`create-section-${s.key}`}>
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

      <section id="sec-extras" className={`${cardClass} scroll-mt-32 space-y-4 p-4 sm:p-5`} data-testid="create-section-extras" data-invalid={fieldErrors.extras ? true : undefined}>
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
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 px-4 py-3 backdrop-blur min-[900px]:left-[248px]" data-testid="save-bar">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1" data-testid="completeness">
            <div className="flex items-center justify-between text-xs text-ink-2"><span>{tf("completeness")}</span><span className="font-semibold tabular-nums text-ink" data-testid="completeness-value">{percent}%</span></div>
            <div className="mt-1 h-2 rounded-full bg-hover" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={tf("completeness")}><div className="h-2 rounded-full bg-accent" style={{ width: `${percent}%` }} /></div>
          </div>
          <button type="submit" disabled={pending} className={btnPrimary} data-testid="save-candidate">
            {pending ? tc("saving") : tf("save")}
          </button>
          <Link href="/candidates" className={btnSecondary} onClick={(e) => { if (dirty && !window.confirm(tf("leaveConfirm"))) e.preventDefault(); }}>{tc("cancel")}</Link>
        </div>
      </div>
    </form>
  );
}
