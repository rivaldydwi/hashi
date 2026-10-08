import { getTranslations } from "next-intl/server";
import { cardClass, inputClass, labelClass } from "@/components/styles";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { saveJpProfile } from "../jp-actions";
import type { JpProfile } from "../renewal-queries";

/**
 * Data pekerja di Jepang (T-021): alamat tinggal (住居地) dan telepon/HP, untuk perpanjangan 在留カード online. Milik TSK (bukan profil kandidat: LPK tidak perlu melihatnya).
 * Staf TSK organisasi sama membaca; mengubah = TSK_ADMIN atau 担当. Alamat dan telepon adalah identitas (translate="no").
 */
export async function JpProfileSection({ candidateId, profile, canEdit }: { candidateId: string; profile: JpProfile | null; canEdit: boolean }) {
  const t = await getTranslations("cards.jp");
  return (
    <section id="jp-profile" className={`${cardClass} space-y-3 p-4 sm:p-5`} aria-labelledby="jp-title" data-testid="jp-profile" data-can-edit={canEdit ? "true" : "false"}>
      <div>
        <h3 id="jp-title" className="text-[16px] font-semibold">{t("title")}</h3>
        <p className="text-sm text-ink-2">{t("intro")}</p>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-ink-2">{t("address")}</dt><dd className="font-medium" translate="no" data-testid="jp-address-value">{profile?.addressJp || "—"}</dd></div>
        <div><dt className="text-ink-2">{t("phone")}</dt><dd className="font-medium" translate="no" data-testid="jp-phone-value">{profile?.phoneJp || "—"}</dd></div>
      </dl>
      {canEdit ? (
        <details className="rounded-xl border border-line p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold" data-testid="jp-edit-toggle">{t("edit")}</summary>
          <ActionForm action={saveJpProfile} hidden={{ candidateId }} submitLabel={t("save")} className="mt-2 space-y-3" testId="jp-form">
            <div className="space-y-1.5"><label htmlFor="jp-address" className={labelClass}>{t("address")}</label><textarea id="jp-address" name="addressJp" rows={2} maxLength={300} lang="ja" defaultValue={profile?.addressJp ?? ""} className={`${inputClass} min-h-16 py-2`} data-testid="jp-address" /></div>
            <div className="space-y-1.5"><label htmlFor="jp-phone" className={labelClass}>{t("phone")}</label><input id="jp-phone" name="phoneJp" maxLength={40} inputMode="tel" autoComplete="off" defaultValue={profile?.phoneJp ?? ""} className={inputClass} data-testid="jp-phone" /></div>
          </ActionForm>
        </details>
      ) : (
        <p className="text-xs text-ink-2" data-testid="jp-readonly">{t("readOnly")}</p>
      )}
      <p className="text-xs text-ink-2">{t("note")}</p>
    </section>
  );
}
