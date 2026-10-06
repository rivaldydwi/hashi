"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { btnPrimary, btnSecondary } from "@/components/styles";
import type { Sheet } from "@/lib/pdf/client-sheet-model";
import { SheetPreview } from "./SheetPreview";

export type SheetModels = Record<"internal-ja" | "internal-jaid" | "share-ja" | "share-jaid", Sheet>;

/**
 * Dialog "Ekspor PDF": mode (Hanya internal / Untuk dibagikan), bahasa label, pratinjau isi PDF, petunjuk kelengkapan, dan (mode dibagikan) daftar
 * yang sengaja tidak disertakan + centang konfirmasi WAJIB sebelum tombol unduh aktif (server menolak tanpa confirm=1).
 * Semua model dihitung server; di sini hanya memilih salah satu (tanpa fetch ulang). Tidak ada penyimpanan di browser.
 */
export function ExportDialog({ models, baseHref, testid }: { models: SheetModels; baseHref: string; testid: string }) {
  const t = useTranslations("sheet");
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"internal" | "share">("internal");
  const [lang, setLang] = useState<"ja" | "jaid">("ja");
  const [ok, setOk] = useState(false);
  const sheet = models[`${mode}-${lang}`];
  const sep = baseHref.includes("?") ? "&" : "?";
  const href = `${baseHref}${sep}mode=${mode}&lang=${lang}${mode === "share" ? "&confirm=1" : ""}`;
  const radio = "flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft";
  const canDownload = mode === "internal" || ok;

  return (
    <>
      <button type="button" className={btnSecondary} onClick={() => { setOk(false); ref.current?.showModal(); }} data-testid={`${testid}-open`}>{t("open")}</button>
      <dialog
        ref={ref}
        aria-labelledby={`${testid}-title`}
        className="m-auto max-h-[92vh] w-[min(62rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-line bg-card p-0 text-ink backdrop:bg-black/40"
        data-testid={`${testid}-dialog`}
      >
        <div className="space-y-4 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 id={`${testid}-title`} className="text-[19px] font-semibold">{t("dialogTitle")}</h2>
            <button type="button" className={btnSecondary} onClick={() => ref.current?.close()} data-testid="sheet-close">{t("close")}</button>
          </div>
          <p className="text-sm text-ink-2">{t("draftNote")}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t("modeLabel")}</legend>
              <label className={radio}><input type="radio" name={`${testid}-mode`} checked={mode === "internal"} onChange={() => setMode("internal")} className="mt-0.5 h-5 w-5" data-testid="mode-internal" /><span><span className="font-medium">{t("modeInternal")}</span><br /><span className="text-xs text-ink-2">{t("modeInternalHint")}</span></span></label>
              <label className={radio}><input type="radio" name={`${testid}-mode`} checked={mode === "share"} onChange={() => { setMode("share"); setOk(false); }} className="mt-0.5 h-5 w-5" data-testid="mode-share" /><span><span className="font-medium">{t("modeShare")}</span><br /><span className="text-xs text-ink-2">{t("modeShareHint")}</span></span></label>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t("langLabel")}</legend>
              <label className={radio}><input type="radio" name={`${testid}-lang`} checked={lang === "ja"} onChange={() => setLang("ja")} className="mt-0.5 h-5 w-5" data-testid="lang-ja" /><span className="font-medium">{t("langJa")}</span></label>
              <label className={radio}><input type="radio" name={`${testid}-lang`} checked={lang === "jaid"} onChange={() => setLang("jaid")} className="mt-0.5 h-5 w-5" data-testid="lang-jaid" /><span className="font-medium">{t("langJaid")}</span></label>
            </fieldset>
          </div>

          {sheet.missing.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="note" data-testid="sheet-missing">{t("missingHint", { fields: sheet.missing.map((k) => t(`missing.${k}`)).join(", ") })}</p>
          )}
          {sheet.skipped.length > 0 && (
            <p className="rounded-lg bg-stone-100 p-3 text-sm text-ink-2" role="note" data-testid="sheet-skipped">{t("skippedHint")} <span lang="ja">{sheet.skipped.join("、")}</span></p>
          )}
          {mode === "share" && (
            <div className="rounded-lg border border-line p-3 text-sm" data-testid="sheet-excluded">
              <p className="font-medium">{t("excludedTitle")}</p>
              <ul className="mt-1 list-disc pl-5 text-ink-2">{sheet.excluded.map((k) => (<li key={k}>{t(`excluded.${k}`)}</li>))}</ul>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">{t("previewTitle")}</p>
            <SheetPreview sheet={sheet} />
          </div>

          <div className="space-y-3 border-t border-line pt-4">
            {mode === "share" && (
              <label className="flex min-h-11 items-start gap-3 text-sm font-medium"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5 h-5 w-5" data-testid="sheet-confirm" />{t("confirmText")}</label>
            )}
            {canDownload ? (
              <a href={href} download className={btnPrimary} data-testid="sheet-download">{t("download")}</a>
            ) : (
              <button type="button" disabled aria-disabled="true" className={btnPrimary} data-testid="sheet-download-disabled">{t("download")}</button>
            )}
            {!canDownload && <p className="text-xs text-ink-2">{t("confirmRequired")}</p>}
          </div>
        </div>
      </dialog>
    </>
  );
}
