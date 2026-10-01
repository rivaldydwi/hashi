import { getFormatter, getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import { todayInTskTz } from "@/db/time";
import type { CurrentUser } from "@/lib/session";
import { TskAssessmentForm } from "./TskAssessmentForm";
import { SCORE_NAMES, TSK_ASSESSMENT_FIELDS, averageOf, formatAvg } from "./fields";
import type { TskRow } from "./queries";

const toValues = (row: TskRow | null, today: string): Record<string, string | boolean> =>
  Object.fromEntries(
    TSK_ASSESSMENT_FIELDS.map((f) => {
      if (!row) return [f.name, f.name === "assessedOn" ? today : f.name === "durationMinutes" ? "30" : ""];
      const raw = (row as unknown as Record<string, unknown>)[f.name];
      return [f.name, raw === null || raw === undefined ? "" : String(raw)];
    }),
  );

/**
 * Penilaian TSK pada halaman detail.
 * - TSK: form kunjungan (selalu ada) dan interview (nonaktif + penjelasan sampai keputusan TSK itu memenuhi syarat),
 *   serta daftar penilaian organisasinya sendiri (ubah: penilainya atau TSK_ADMIN).
 * - LPK_ADMIN: hanya daftar yang DIBAGIKAN TSK ("Penilaian dari TSK"), baca saja; null bila kosong.
 * Sensei tidak pernah memanggil komponen ini (datanya pun tidak dibaca).
 */
export async function TskAssessmentsSection({ candidateId, rows, me, canInterview }: { candidateId: string; rows: TskRow[]; me: CurrentUser; canInterview: boolean }) {
  const tsk = me.role === "TSK_ADMIN" || me.role === "TSK_STAFF";
  if (!tsk && rows.length === 0) return null;
  const t = await getTranslations("assessments");
  const ts = await getTranslations("detail.sections.assessment");
  const format = await getFormatter();
  const today = todayInTskTz();
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const canEdit = (r: TskRow) => tsk && (me.role === "TSK_ADMIN" || r.assessorId === me.id);
  const scoreText = (n: number | null) => (n === null ? "—" : String(n));

  return (
    <section className={`${cardClass} space-y-4 p-4 sm:p-5`} data-testid="section-tsk-assessments">
      <div>
        <h2 className="font-medium">{tsk ? t("tsk.title") : t("tsk.lpkTitle")}</h2>
        <p className="mt-1 text-sm text-stone-500">{tsk ? t("tsk.intro") : t("tsk.lpkIntro")}</p>
      </div>

      {tsk && (
        <div className="grid gap-3 lg:grid-cols-2">
          <details className="rounded-lg border border-stone-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-brand-700" data-testid="tsk-visit-toggle">+ {t("tsk.addVisit")}</summary>
            <TskAssessmentForm candidateId={candidateId} kind="TSK_VISIT" values={toValues(null, today)} visibility="TSK_ONLY" maxDate={today} />
          </details>
          {canInterview ? (
            <details className="rounded-lg border border-stone-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-700" data-testid="tsk-interview-toggle">+ {t("tsk.addInterview")}</summary>
              <TskAssessmentForm candidateId={candidateId} kind="TSK_INTERVIEW" values={toValues(null, today)} visibility="TSK_ONLY" maxDate={today} />
            </details>
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3 text-sm text-stone-500" data-testid="tsk-interview-locked" aria-disabled="true">
              <p className="font-medium text-stone-600">+ {t("tsk.addInterview")}</p>
              <p className="mt-1">{t("tsk.interviewLocked")}</p>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-stone-500" data-testid="tsk-assessment-empty">{t("tsk.empty")}</p>
      ) : (
        <ul className="space-y-3" data-testid="tsk-assessment-list">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-stone-200 p-3" data-testid="tsk-assessment" data-kind={r.kind} data-visibility={r.visibility}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{t(`tsk.kinds.${r.kind}`)}</p>
                  <p className="text-xs text-stone-500">
                    {day(r.assessedOn)} · {r.durationMinutes} {t("minutes")} · {tsk ? (r.assessorName ?? "—") : r.orgName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {tsk && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.visibility === "TSK_ONLY" ? "bg-stone-100 text-stone-700" : "bg-sky-50 text-sky-800"}`}>
                      {r.visibility === "TSK_ONLY" ? t("tsk.tskOnly") : t("tsk.shared")}
                    </span>
                  )}
                  <span className="text-lg font-semibold tabular-nums">{formatAvg(averageOf(r))}</span>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
                {SCORE_NAMES.map((n) => (
                  <div key={n} className="flex justify-between gap-2">
                    <dt className="text-stone-500">{ts(`fields.${n}`)}</dt>
                    <dd className="tabular-nums">{scoreText(r[n])}</dd>
                  </div>
                ))}
              </dl>
              {(r.note || r.followUp) && (
                <dl className="mt-2 space-y-1 text-sm">
                  {r.note && (
                    <div>
                      <dt className="text-xs text-stone-500">{ts("fields.note")}</dt>
                      <dd className="whitespace-pre-line" data-testid="tsk-assessment-note">{r.note}</dd>
                    </div>
                  )}
                  {r.followUp && (
                    <div>
                      <dt className="text-xs text-stone-500">{ts("fields.followUp")}</dt>
                      <dd className="whitespace-pre-line">{r.followUp}</dd>
                    </div>
                  )}
                </dl>
              )}
              {canEdit(r) && (
                <details className="mt-2 border-t border-stone-100 pt-2 text-sm">
                  <summary className="cursor-pointer font-medium text-brand-700">{t("detailAndEdit")}</summary>
                  <TskAssessmentForm candidateId={candidateId} kind={r.kind as "TSK_VISIT" | "TSK_INTERVIEW"} assessmentId={r.id} values={toValues(r, today)} visibility={r.visibility} maxDate={today} />
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
