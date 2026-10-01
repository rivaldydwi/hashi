import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { candidateStage, selectionDecision } from "@/db/schema";
import type { CandidateFilters as Filters } from "./queries";

/** Filter daftar kandidat. Memakai form GET biasa, jadi hasilnya bisa di-bookmark dan tanpa JavaScript. */
export async function CandidateFilters({
  filters,
  fields,
  isTsk,
}: {
  filters: Filters;
  fields: Array<{ code: string; label: string }>;
  isTsk: boolean;
}) {
  const t = await getTranslations();
  const active = filters.q || filters.stage || filters.field || filters.decision || filters.avg || filters.attendance || filters.jlpt;

  return (
    // key = nilai filter: navigasi sisi klien (mis. tombol Reset) tidak me-remount form, dan kolom
    // ber-defaultValue tidak ikut berubah. Dengan key, form dibuat ulang setiap filter di URL berubah.
    <form
      key={`${filters.q}|${filters.stage}|${filters.field}|${filters.decision}|${filters.avg}|${filters.attendance}|${filters.jlpt}`}
      method="get"
      action="/candidates"
      className={`${cardClass} mb-4 p-4`}
      data-testid="candidate-filters"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor="q" className={labelClass}>{t("candidates.filterSearch")}</label>
          <input id="q" name="q" defaultValue={filters.q} maxLength={100} placeholder={t("candidates.searchPlaceholder")} className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="stage" className={labelClass}>{t("candidates.filterStage")}</label>
          <select id="stage" name="stage" defaultValue={filters.stage} className={inputClass}>
            <option value="">{t("candidates.all")}</option>
            {candidateStage.enumValues.map((s) => (
              <option key={s} value={s}>{t(`stages.${s}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="field" className={labelClass}>{t("candidates.filterField")}</label>
          <select id="field" name="field" defaultValue={filters.field} className={inputClass}>
            <option value="">{t("candidates.all")}</option>
            {fields.map((f) => (
              <option key={f.code} value={f.code}>{f.label}</option>
            ))}
          </select>
        </div>
        {isTsk && (
          <div className="space-y-1.5">
            <label htmlFor="decision" className={labelClass}>{t("candidates.filterDecision")}</label>
            <select id="decision" name="decision" defaultValue={filters.decision} className={inputClass}>
              <option value="">{t("candidates.all")}</option>
              {selectionDecision.enumValues.map((d) => (
                <option key={d} value={d}>{t(`decisions.${d}`)}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="avg" className={labelClass}>{t("candidates.filterAvg")}</label>
          <input id="avg" name="avg" type="number" inputMode="decimal" min={1} max={5} step={0.1} defaultValue={filters.avg} placeholder="3.5" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="attendance" className={labelClass}>{t("candidates.filterAttendance")}</label>
          <input id="attendance" name="attendance" type="number" inputMode="numeric" min={0} max={100} step={1} defaultValue={filters.attendance} placeholder="80" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="jlpt" className={labelClass}>{t("candidates.filterJlpt")}</label>
          <select id="jlpt" name="jlpt" defaultValue={filters.jlpt} className={inputClass}>
            <option value="">{t("candidates.all")}</option>
            {["N5", "N4", "N3", "N2", "N1"].map((n) => (
              <option key={n} value={n}>{t("candidates.jlptAtLeast", { level: n })}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-2 text-xs text-stone-500">{t("candidates.filterAssessmentHint")}</p>
      <div className="mt-3 flex gap-2">
        <button type="submit" className={btnPrimary}>{t("candidates.apply")}</button>
        {active && (
          <Link href="/candidates" className={btnSecondary}>{t("candidates.reset")}</Link>
        )}
      </div>
    </form>
  );
}
