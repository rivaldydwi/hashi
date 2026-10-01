import { getFormatter, getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import { todayInAppTz } from "@/db/time";
import type { CurrentUser } from "@/lib/session";
import { AssessmentForm } from "./AssessmentForm";
import { ASSESSMENT_FIELDS, SCORE_NAMES, averageOf, formatAvg, trendOf, type Trend } from "./fields";
import type { MonthlyRow } from "./queries";

const TREND_STYLE: Record<Trend, string> = {
  up: "bg-emerald-50 text-emerald-800",
  down: "bg-rose-50 text-rose-800",
  same: "bg-stone-100 text-stone-700",
};
const TREND_MARK: Record<Trend, string> = { up: "▲", down: "▼", same: "＝" };

const toValues = (row: MonthlyRow | null, today: string): Record<string, string | boolean> =>
  Object.fromEntries(
    ASSESSMENT_FIELDS.map((f) => {
      if (!row) return [f.name, f.name === "assessedOn" ? today : f.name === "durationMinutes" ? "30" : ""];
      const raw = (row as unknown as Record<string, unknown>)[f.name];
      return [f.name, raw === null || raw === undefined ? "" : String(raw)];
    }),
  );

/**
 * Penilaian bulanan LPK pada halaman detail: form tambah, riwayat (terbaru di atas) dengan rata-rata empat nilai
 * dan tren dibanding penilaian sebelumnya. Hanya berisi penilaian (tidak ada data sensitif dari candidate_private),
 * jadi aman dirender untuk sensei. Tabel di layar lebar, kartu di ponsel.
 */
export async function AssessmentsSection({ candidateId, rows, me, readOnly = false }: { candidateId: string; rows: MonthlyRow[]; me: CurrentUser; readOnly?: boolean }) {
  const t = await getTranslations("assessments");
  const ts = await getTranslations("detail.sections.assessment");
  const format = await getFormatter();
  const today = todayInAppTz(); // batas tanggal form = hari ini menurut APP_TIMEZONE
  const month = (period: string) => format.dateTime(new Date(`${period}T00:00:00Z`), { month: "long", year: "numeric", timeZone: "UTC" });
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const canEdit = (r: MonthlyRow) => !readOnly && me.role === "LPK_ADMIN" || (me.role === "LPK_SENSEI" && r.assessorId === me.id);

  const items = rows.map((r, i) => {
    const avg = averageOf(r);
    const prev = rows[i + 1] ? averageOf(rows[i + 1]) : null;
    return { r, avg, trend: trendOf(avg, prev) };
  });
  const scoreText = (n: number | null) => (n === null ? "—" : String(n));

  const TrendBadge = ({ trend }: { trend: Trend | null }) =>
    trend ? (
      <span className={`ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TREND_STYLE[trend]}`} data-testid="assessment-trend" data-trend={trend}>
        {TREND_MARK[trend]} {t(`trend.${trend}`)}
      </span>
    ) : null;

  const Detail = ({ r }: { r: MonthlyRow }) => (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-brand-700">{readOnly ? t("detail") : t("detailAndEdit")}</summary>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-stone-500">{ts("fields.note")}</dt>
          <dd className="whitespace-pre-line" data-testid="assessment-note">{r.note ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{ts("fields.followUp")}</dt>
          <dd className="whitespace-pre-line">{r.followUp ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("assessor")}</dt>
          <dd>{r.assessorName ?? "—"} · {r.durationMinutes} {t("minutes")}</dd>
        </div>
      </dl>
      {canEdit(r) ? (
        <AssessmentForm candidateId={candidateId} assessmentId={r.id} values={toValues(r, today)} maxDate={today} />
      ) : (
        !readOnly && <p className="mt-2 text-xs text-stone-500">{t("notEditable")}</p>
      )}
    </details>
  );

  return (
    <section id="penilaian" className={`${cardClass} scroll-mt-4 p-4 sm:p-5`} data-testid="section-assessments">
      <h2 className="font-medium">{readOnly ? t("tsk.readOnlyTitle") : ts("title")}</h2>
      <p className="mt-1 text-sm text-stone-500">{readOnly ? t("tsk.readOnlyIntro") : t("intro")}</p>

      {!readOnly && (
        <details className="mt-3 rounded-lg border border-stone-200 p-3" open={rows.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700" data-testid="assessment-add-toggle">+ {t("add")}</summary>
          <AssessmentForm candidateId={candidateId} values={toValues(null, today)} maxDate={today} />
        </details>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500" data-testid="assessment-empty">{t("empty")}</p>
      ) : (
        <>
          {/* Layar lebar: tabel */}
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm" data-testid="assessment-table">
              <thead className="border-y border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("colMonth")}</th>
                  {SCORE_NAMES.map((n) => (
                    <th key={n} className="px-3 py-2 font-medium">{ts(`fields.${n}`)}</th>
                  ))}
                  <th className="px-3 py-2 font-medium">{t("colAvg")}</th>
                  <th className="px-3 py-2 font-medium">{ts("fields.attendancePct")}</th>
                  <th className="px-3 py-2 font-medium">{t("colTest")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {items.map(({ r, avg, trend }) => (
                  <>
                    <tr key={r.id} data-testid="assessment-row">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="font-medium">{month(r.period)}</div>
                        <div className="text-xs text-stone-500">{day(r.assessedOn)}</div>
                      </td>
                      {SCORE_NAMES.map((n) => (
                        <td key={n} className="px-3 py-2 tabular-nums">{scoreText(r[n])}</td>
                      ))}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold tabular-nums" data-testid="assessment-avg">{formatAvg(avg)}</span>
                        <TrendBadge trend={trend} />
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.attendancePct === null ? "—" : `${r.attendancePct}%`}</td>
                      <td className="px-3 py-2 text-xs">{r.testName ? `${r.testName}${r.testScore !== null ? `: ${r.testScore}` : ""}` : "—"}</td>
                    </tr>
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={7} className="px-3 pb-3"><Detail r={r} /></td>
                    </tr>
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ponsel: kartu */}
          <ul className="mt-4 space-y-3 md:hidden" data-testid="assessment-cards">
            {items.map(({ r, avg, trend }) => (
              <li key={r.id} className="rounded-xl border border-stone-200 p-3" data-testid="assessment-card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{month(r.period)}</p>
                    <p className="text-xs text-stone-500">{day(r.assessedOn)}</p>
                  </div>
                  <p className="text-right">
                    <span className="text-lg font-semibold tabular-nums">{formatAvg(avg)}</span>
                    <TrendBadge trend={trend} />
                  </p>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {SCORE_NAMES.map((n) => (
                    <div key={n} className="flex justify-between gap-2">
                      <dt className="text-stone-500">{ts(`fields.${n}`)}</dt>
                      <dd className="tabular-nums">{scoreText(r[n])}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">{ts("fields.attendancePct")}</dt>
                    <dd className="tabular-nums">{r.attendancePct === null ? "—" : `${r.attendancePct}%`}</dd>
                  </div>
                  {r.testName && (
                    <div className="col-span-2 flex justify-between gap-2">
                      <dt className="text-stone-500">{t("colTest")}</dt>
                      <dd>{r.testName}{r.testScore !== null ? `: ${r.testScore}` : ""}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-2 border-t border-stone-100 pt-2"><Detail r={r} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
