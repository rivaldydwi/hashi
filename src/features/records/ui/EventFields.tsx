import { getTranslations } from "next-intl/server";
import { inputClass, labelClass } from "@/components/styles";

export type EventDefaults = { date: string; time: string; event: string; subjectStatement: string; companyResponse: string; note: string; includeInClientExport: boolean };

/** Isian satu baris kronologi (③): lima kolom 日時, 出来事・状況, 本人の発言・対応, 当社の対応, 備考 + tanda "ikut ekspor klien". */
export async function EventFields({ d, prefix }: { d: EventDefaults; prefix: string }) {
  const t = await getTranslations("records");
  const area = `${inputClass} min-h-16 py-2`;
  return (
    <div className="space-y-3">
      <input type="hidden" name="includeSet" value="1" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><label className={labelClass} htmlFor={`${prefix}-date`}>{t("f.date")} *</label><input id={`${prefix}-date`} name="date" type="date" required defaultValue={d.date} className={inputClass} /></div>
        <div className="space-y-1.5"><label className={labelClass} htmlFor={`${prefix}-time`}>{t("f.timeOptional")}</label><input id={`${prefix}-time`} name="time" type="time" defaultValue={d.time} className={inputClass} /></div>
      </div>
      {(["event", "subjectStatement", "companyResponse", "note"] as const).map((k) => (
        <div key={k} className="space-y-1.5">
          <label className={labelClass} htmlFor={`${prefix}-${k}`}>{t(`f.tl_${k}`)}{k === "event" ? " *" : ""}</label>
          <textarea id={`${prefix}-${k}`} name={k} defaultValue={d[k]} required={k === "event"} rows={2} lang="ja" maxLength={4000} className={area} />
        </div>
      ))}
      <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="includeInClientExport" defaultChecked={d.includeInClientExport} className="h-5 w-5" />{t("cases.includeInClient")}</label>
    </div>
  );
}
