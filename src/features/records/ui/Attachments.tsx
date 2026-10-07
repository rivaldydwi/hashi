import { getTranslations } from "next-intl/server";
import { cardClass, inputClass, labelClass } from "@/components/styles";
import type { activityAttachments } from "@/db/schema";
import { removeAttachment, updateAttachment, uploadAttachment } from "../actions";
import { ActionForm } from "./ActionForm";

type Att = typeof activityAttachments.$inferSelect;

/** Foto lampiran: thumbnail (rute unduh terlindungi), keterangan, sertakan-di-PDF, sembunyikan. Unggah foto baru bila boleh. */
export async function Attachments({ items, parent, canEdit, left }: { items: Att[]; parent: { recordId?: string; interviewId?: string }; canEdit: boolean; left: number }) {
  const t = await getTranslations("records");
  return (
    <section className={`${cardClass} p-4 sm:p-5`} data-testid="attachments" aria-labelledby="att-title">
      <h2 id="att-title" className="text-[17px] font-semibold">{t("photos.title")}</h2>
      {items.length === 0 ? <p className="mt-2 text-sm text-ink-2">{t("photos.none")}</p> : (
        <ul className="mt-3 grid gap-4 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.id} className="space-y-2 rounded-xl border border-line p-3" data-testid="attachment-item">
              <a href={`/records/attachments/${a.id}`} target="_blank" rel="noreferrer" aria-label={t("photos.open")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/records/attachments/${a.id}`} alt={a.caption ?? t("photos.altDefault")} loading="lazy" className="h-40 w-full rounded-lg bg-hover object-contain" data-testid="attachment-img" />
              </a>
              {canEdit ? (
                <ActionForm action={updateAttachment} hidden={{ id: a.id }} submitLabel={t("photos.saveCaption")} submitTone="secondary" className="space-y-2">
                  <label className={labelClass} htmlFor={`cap-${a.id}`}>{t("f.caption")}</label>
                  <input id={`cap-${a.id}`} name="caption" defaultValue={a.caption ?? ""} maxLength={300} lang="ja" className={inputClass} />
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="includeInPdf" defaultChecked={a.includeInPdf} className="h-5 w-5" />{t("f.includeInPdf")}</label>
                </ActionForm>
              ) : (
                <p className="text-sm">{a.caption ?? "—"} {a.includeInPdf && <span className="text-xs text-ink-2">({t("photos.inPdf")})</span>}</p>
              )}
              {canEdit && <ActionForm action={removeAttachment} hidden={{ id: a.id }} submitLabel={t("photos.remove")} submitTone="danger" testId="remove-attachment" />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && left > 0 && (
        <ActionForm action={uploadAttachment} hidden={Object.fromEntries(Object.entries(parent).filter(([, v]) => v) as Array<[string, string]>)} submitLabel={t("photos.upload")} submitTone="secondary" className="mt-4 space-y-2 border-t border-line pt-4" resetOnSuccess testId="upload-attachment-form">
          <p className="text-xs text-ink-2">{t("f.photosHint", { n: left })}</p>
          <label className={labelClass} htmlFor="att-file">{t("photos.chooseFile")}</label>
          <input id="att-file" name="file" type="file" required accept="image/jpeg,image/png,image/webp" className={inputClass} data-testid="attachment-file" />
          <input name="caption" placeholder={t("f.caption")} aria-label={t("f.caption")} maxLength={300} lang="ja" className={inputClass} />
          <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="includeInPdf" className="h-5 w-5" />{t("f.includeInPdf")}</label>
        </ActionForm>
      )}
    </section>
  );
}
