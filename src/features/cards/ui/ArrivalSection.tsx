import { getTranslations } from "next-intl/server";
import { cardClass, inputClass, labelClass } from "@/components/styles";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { saveArrival } from "../arrival-actions";

/**
 * Tanggal tiba di Jepang (T-024), diisi TSK_ADMIN / 担当 efektif; LPK_ADMIN pemilik melihatnya (bersama status visa) di detail kandidat lewat fungsi sempit, tanpa data penempatan lain.
 * Staf lain: baca-saja dengan penjelasan.
 */
export async function ArrivalSection({ candidateId, arrivedOn, today, canEdit }: { candidateId: string; arrivedOn: string | null; today: string; canEdit: boolean }) {
  const t = await getTranslations("cards.arrival");
  return (
    <section className={`${cardClass} space-y-3 p-4 sm:p-5`} aria-labelledby="arrival-title" data-testid="arrival-section" data-can-edit={canEdit ? "true" : "false"}>
      <div>
        <h3 id="arrival-title" className="text-[16px] font-semibold">{t("title")}</h3>
        <p className="text-sm text-ink-2">{t("intro")}</p>
      </div>
      <p className="text-sm"><span className="text-ink-2">{t("label")}: </span><span className="font-medium" translate="no" data-testid="arrival-value">{arrivedOn ? arrivedOn.replace(/-/g, "/") : "—"}</span></p>
      {canEdit ? (
        <ActionForm action={saveArrival} hidden={{ candidateId }} submitLabel={t("save")} className="space-y-2" testId="arrival-form">
          <div className="space-y-1.5">
            <label htmlFor="arrival-date" className={labelClass}>{t("label")}</label>
            <input id="arrival-date" name="arrivedOn" type="date" max={today} defaultValue={arrivedOn ?? ""} className={inputClass} data-testid="arrival-date" />
            <p className="text-xs text-ink-2">{t("hint")}</p>
          </div>
        </ActionForm>
      ) : (
        <p className="text-xs text-ink-2" data-testid="arrival-readonly">{t("readOnly")}</p>
      )}
    </section>
  );
}
