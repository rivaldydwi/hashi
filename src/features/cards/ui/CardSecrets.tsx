import { getLocale, getTranslations } from "next-intl/server";
import { inputClass, labelClass } from "@/components/styles";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { clearCardNumber, removeCardPhoto, saveCardNumber, uploadCardPhoto } from "../secret-actions";
import type { CardSecretsMeta } from "../secret-queries";
import { NumberReveal } from "./NumberReveal";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Nomor dan foto satu kartu (T-020). Hanya dirender untuk TSK_ADMIN / 担当 efektif (data tidak dikueri untuk yang lain). Nomor: tersamar + "Tampilkan" (audit);
 * foto: unduh lewat route handler terenkripsi (audit), ganti/hapus per sisi. Tidak ada nilai asli di HTML.
 */
export async function CardSecrets({ cardId, meta, testPrefix = "card" }: { cardId: string; meta: CardSecretsMeta; testPrefix?: string }) {
  const t = await getTranslations("cards.secrets");
  const locale = await getLocale();
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="space-y-4" data-testid={`${testPrefix}-secrets`} data-card-id={cardId}>
      <div>
        <h4 className="text-sm font-semibold">{t("title")}</h4>
        <p className="text-xs text-ink-2">{t("intro")}</p>
      </div>

      <div className="space-y-2">
        <p className={labelClass}>{t("number")}</p>
        {meta.numberMasked ? <NumberReveal cardId={cardId} masked={meta.numberMasked} /> : <p className="text-sm text-ink-2" data-testid="card-number-none">{t("numberNone")}</p>}
        <details className="rounded-xl border border-line p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold" data-testid="card-number-edit-toggle">{meta.numberMasked ? t("replaceNumber") : t("saveNumber")}</summary>
          <ActionForm action={saveCardNumber} hidden={{ id: cardId }} submitLabel={t("saveNumber")} resetOnSuccess className="mt-2 space-y-2" testId="card-number-form">
            <label htmlFor={`num-${cardId}`} className={labelClass}>{t("number")}</label>
            <input id={`num-${cardId}`} name="number" required maxLength={20} autoComplete="off" spellCheck={false} placeholder="AA00000000AA" className={`${inputClass} font-mono`} data-testid="card-number-input" />
            <p className="text-xs text-ink-2">{t("numberHint")}</p>
          </ActionForm>
          {meta.numberMasked && (
            <ActionForm action={clearCardNumber} hidden={{ id: cardId }} submitLabel={t("clearNumber")} submitTone="danger" className="mt-3" testId="card-number-clear-form" />
          )}
        </details>
      </div>

      <div className="space-y-3">
        <p className={labelClass}>{t("photos")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["front", "back"] as const).map((side) => {
            const p = meta.photos.find((x) => x.side === side);
            return (
              <div key={side} className="space-y-2 rounded-xl border border-line p-3" data-testid={`card-photo-${side}`} data-has-photo={p ? "true" : "false"}>
                <p className="text-sm font-medium">{t(side)}</p>
                {p ? (
                  <div className="space-y-1 text-sm">
                    <a href={`/records/cards/photo/${p.id}`} className="inline-flex min-h-11 items-center font-semibold text-accent-text underline" data-testid={`card-photo-${side}-link`}>{t("download")}</a>
                    <p className="text-xs text-ink-2" translate="no">{p.mime === "application/pdf" ? "PDF" : p.mime === "image/png" ? "PNG" : "JPG"} · {kb(p.sizeBytes)} · {fmt.format(p.createdAt)}</p>
                    <ActionForm action={removeCardPhoto} hidden={{ photoId: p.id }} submitLabel={t("remove")} submitTone="danger" testId={`card-photo-${side}-remove`} />
                  </div>
                ) : <p className="text-sm text-ink-2">{t("photoNone")}</p>}
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold" data-testid={`card-photo-${side}-toggle`}>{p ? t("replace") : t("upload")}</summary>
                  <ActionForm action={uploadCardPhoto} hidden={{ id: cardId, side }} submitLabel={t("upload")} resetOnSuccess className="mt-2 space-y-2" testId={`card-photo-${side}-form`}>
                    <input name="file" type="file" required accept="image/jpeg,image/png,application/pdf" className={inputClass} aria-label={t(side)} data-testid={`card-photo-${side}-file`} />
                    <p className="text-xs text-ink-2">{t("fileHint")}</p>
                  </ActionForm>
                </details>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
