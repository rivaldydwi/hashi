import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { gridTd, gridTdText, gridTh, btnPrimary, btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { fiscalMonths, fiscalTitle, fiscalYearOf, monthMark, quarterOfMonth, type MonthMark, type QuarterState } from "@/db/records-core";
import { requireStaff } from "@/features/records/access";
import { saveQuarterNote } from "@/features/records/actions";
import { listResponsibleStaff, workersWithResponsible } from "@/db/responsibility-queries";
import { interviewRowsFull, listStaff, quarterNotes, quartersOfFiscalYear } from "@/features/records/queries";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICON: Record<MonthMark | QuarterState, string> = { done: "✅", open: "⏳", missed: "🔴", na: "➖", notDue: "", none: "", notRequired: "" };

/**
 * Tab Wawancara berkala (定期面談 / Teiki Mendan): grid pekerja x 12 bulan tahun fiskal (April-Maret) seperti lembar Excel TSK. Status UTAMA per KUARTAL (aturan staf TSK: minimal sekali per kuartal,
 * sejak mulai bekerja); bulan tetap tampil karena wawancara boleh bulanan. Baris = semua pekerja yang bekerja minimal satu hari di tahun fiskal itu, termasuk yang sudah berhenti (T-008).
 */
export default async function InterviewsGridPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  const locale = await getLocale();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const fyParam = Number.parseInt(one(sp.fy), 10);
  const fy = Number.isInteger(fyParam) && fyParam >= 2020 && fyParam <= 2100 ? fyParam : fiscalYearOf(today);
  const months = fiscalMonths(fy);
  const month = months.includes(one(sp.month)) ? one(sp.month) : "";
  const status = (["done", "open", "missed", "na"] as const).find((s) => s === one(sp.status)) ?? "";
  const staffF = UUID.test(one(sp.staff)) ? one(sp.staff) : "";
  const clientF = UUID.test(one(sp.client)) ? one(sp.client) : "";
  const fieldF = one(sp.field).slice(0, 100);
  const viewPending = one(sp.view) === "pending";
  const mine = one(sp.mine) === "1"; // filter "pekerja saya" (T-010): hanya pekerja dengan penanggung jawab efektif = saya

  const { qdata, rows, notes, staff, resp, respStaff } = await tenantQuery(async (tx) => ({ qdata: await quartersOfFiscalYear(tx, fy, today), rows: await interviewRowsFull(tx, fy), notes: await quarterNotes(tx, fy), staff: await listStaff(tx), resp: (await workersWithResponsible(tx, today)).workers, respStaff: await listResponsibleStaff(tx) }));
  const respOf = new Map(resp.map((w) => [w.id, w.responsible]));
  const respName = new Map(respStaff.map((x) => [x.id, x.name]));
  const workers = qdata.map((x) => x.worker);
  const quartersOf = new Map(qdata.map((x) => [x.worker.id, x.quarters]));
  const byKey = new Map(rows.map((r) => [`${r.candidateId}|${r.periodMonth}`, r]));
  const markOf = (w: (typeof workers)[number], m: string) => monthMark(m, byKey.get(`${w.id}|${m}`), today, w.spans);
  const quarterStateOf = (cid: string, q: number): QuarterState => quartersOf.get(cid)?.find((c) => c.q === q)?.state ?? "notRequired";
  const qcell = (cid: string, q: number) => quartersOf.get(cid)?.find((c) => c.q === q);
  const quarterCountOf = (cid: string, q: number) => quartersOf.get(cid)?.find((c) => c.q === q)?.count ?? 0;

  const shown = workers.filter((w) => {
    if (clientF && w.companyId !== clientF) return false;
    if (mine && respOf.get(w.id)?.staffId !== me.id) return false;
    if (fieldF && (locale === "ja" ? w.fieldNameJa : w.fieldNameId) !== fieldF) return false;
    if (staffF && !rows.some((r) => r.candidateId === w.id && r.staffId === staffF)) return false;
    const states = [1, 2, 3, 4].map((q) => quarterStateOf(w.id, q));
    if (viewPending && !states.includes("open")) return false; // sama dengan KPI: kuartal berjalan belum ada wawancara
    if (status) {
      if (month) return quarterStateOf(w.id, quarterOfMonth(month)) === status; // filter bulan: status kuartal bulan itu
      return states.includes(status);
    }
    return true;
  });
  const pendingCells = shown.reduce((n, w) => n + [1, 2, 3, 4].filter((q) => quarterStateOf(w.id, q) === "open").length, 0);
  const fields = [...new Set(workers.map((w) => (locale === "ja" ? w.fieldNameJa : w.fieldNameId)).filter(Boolean))] as string[];
  const companies = [...new Map(workers.map((w) => [w.companyId, w.companyName])).entries()];
  const noteOf = (cid: string, q: number) => notes.find((n) => n.candidateId === cid && n.quarter === q)?.note ?? "";
  const monthLabel = (m: string) => `${Number(m.slice(5, 7))}${locale === "ja" ? "月" : ""}`;
  const resultLabel = (cid: string, m: string) => {
    const r = byKey.get(`${cid}|${m}`);
    return r?.resultStatus ? t(`results.${r.resultStatus}`) : "";
  };
  const hrefFor = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ fy: String(fy), month, status, staff: staffF, client: clientF, field: fieldF, view: viewPending ? "pending" : "", mine: mine ? "1" : "", ...over })) if (v) p.set(k, v);
    return `/records/interviews?${p}`;
  };
  const thc = gridTh;
  const tdc = gridTd;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={hrefFor({ fy: String(fy - 1) })} className={btnSecondary} data-testid="fy-prev">← {fiscalTitle(fy - 1)}</Link>
        <h2 className="px-2 text-[17px] font-semibold" data-testid="fy-title">{t("interviews.fiscalYear")} {fiscalTitle(fy)}</h2>
        <Link href={hrefFor({ fy: String(fy + 1) })} className={btnSecondary}>{fiscalTitle(fy + 1)} →</Link>
      </div>

      <details className={`${cardClass} mb-3`}>
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-ink-menu">{t("filters.title")}</summary>
        <form method="get" action="/records/interviews" className="grid gap-3 border-t border-line p-4 sm:grid-cols-3" data-testid="interview-filters">
          <input type="hidden" name="fy" value={fy} />
          <div className="space-y-1.5"><label htmlFor="month" className={labelClass}>{t("interviews.month")}</label>
            <select id="month" name="month" defaultValue={month} className={inputClass}><option value="">{t("filters.all")}</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></div>
          <div className="space-y-1.5"><label htmlFor="status" className={labelClass}>{t("interviews.cellStatus")}</label>
            <select id="status" name="status" defaultValue={status} className={inputClass}><option value="">{t("filters.all")}</option>{(["done", "open", "missed", "na"] as const).map((s) => <option key={s} value={s}>{t(`interviews.legendState.${s}`)}</option>)}</select></div>
          <div className="space-y-1.5"><label htmlFor="staff" className={labelClass}>{t("filters.staffLabel")}</label>
            <select id="staff" name="staff" defaultValue={staffF} className={inputClass}><option value="">{t("filters.all")}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="space-y-1.5"><label htmlFor="client" className={labelClass}>{t("interviews.client")}</label>
            <select id="client" name="client" defaultValue={clientF} className={inputClass}><option value="">{t("filters.all")}</option>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
          <div className="space-y-1.5"><label htmlFor="field" className={labelClass}>{t("interviews.field")}</label>
            <select id="field" name="field" defaultValue={fieldF} className={inputClass}><option value="">{t("filters.all")}</option>{fields.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
          <label className="inline-flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" name="view" value="pending" defaultChecked={viewPending} className="h-5 w-5" />{t("interviews.onlyPending")}</label>
          <label className="inline-flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={mine} className="h-5 w-5" data-testid="filter-mine-input" />{t("interviews.onlyMine")}</label>
          <div className="flex gap-2 sm:col-span-3"><button type="submit" className={btnPrimary}>{t("filters.apply")}</button><Link href={`/records/interviews?fy=${fy}`} className={btnSecondary}>{t("filters.reset")}</Link></div>
        </form>
      </details>

      {(viewPending || mine || month || status || staffF || clientF || fieldF) && (
        <ul className="mb-3 flex flex-wrap gap-2" data-testid="filter-chips" aria-label={t("filters.active")}>
          {viewPending && <li data-testid="filter-chip" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">{t("interviews.onlyPending")}<Link href={hrefFor({ view: "" })} aria-label={t("filters.remove", { name: t("interviews.onlyPending") })} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10" data-testid="filter-chip-remove">×</Link></li>}
          {mine && <li data-testid="filter-chip" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">{t("interviews.onlyMine")}<Link href={hrefFor({ mine: "" })} aria-label={t("filters.remove", { name: t("interviews.onlyMine") })} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10">×</Link></li>}
          {month && <li data-testid="filter-chip" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">{t("interviews.month")}: {monthLabel(month)}<Link href={hrefFor({ month: "" })} aria-label={t("filters.remove", { name: monthLabel(month) })} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10">×</Link></li>}
          {status && <li data-testid="filter-chip" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">{t(`interviews.legendState.${status}`)}<Link href={hrefFor({ status: "" })} aria-label={t("filters.remove", { name: status })} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10">×</Link></li>}
        </ul>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" data-testid="interview-legend">
        <span className="font-semibold">{t("interviews.legend")}:</span>
        {(["done", "open", "missed", "na"] as const).map((s) => <span key={s}><span aria-hidden>{ICON[s]}</span> {t(`interviews.legendState.${s}`)}</span>)}
        <span className="text-ink-2" data-testid="pending-cells-count">{t("interviews.pendingCells", { n: pendingCells })}</span>
        <Link href={`/records/interviews/annual?fy=${fy}`} className="font-semibold text-accent-text hover:underline" data-testid="annual-link">{t("interviews.annualLink")}</Link>
      </div>
      <p className="mb-3 text-xs text-ink-2" data-testid="interview-rule">{t("interviews.ruleNote")}</p>

      {workers.length === 0 ? (
        <EmptyState testId="interviews-empty" title={t("interviews.emptyTitle")} body={t("interviews.emptyBody")} />
      ) : shown.length === 0 ? (
        <EmptyState testId="interviews-nomatch" title={t("list.noMatchTitle")} body={t("list.noMatchBody")} action={{ href: `/records/interviews?fy=${fy}`, label: t("list.clearFilters") }} />
      ) : (
        <div className={`${cardClass} relative overflow-x-auto`} data-testid="interview-grid-wrap">
          <table className="border-collapse text-left" data-testid="interview-grid">
            <thead><tr>
              <th className={`${thc} sticky left-0 z-10 min-w-40`}>{t("interviews.col.name")}</th>
              <th className={thc}>{t("interviews.col.field")}</th><th className={thc}>{t("interviews.col.start")}</th><th className={thc}>{t("interviews.col.company")}</th>
              <th className={thc}>{t("interviews.col.responsible")}</th><th className={thc}>{t("interviews.col.address")}</th><th className={thc}>{t("interviews.col.phone")}</th><th className={thc}>{t("interviews.col.pic")}</th>
              {months.flatMap((m, i) => {
                const head = <th key={m} className={`${thc} min-w-24 ${m === month ? "bg-accent-soft" : ""}`}>{monthLabel(m)}</th>;
                return i % 3 === 2 ? [head, <th key={`q${i}`} className={`${thc} min-w-64`}>{t("interviews.quarterNote", { q: quarterOfMonth(m) })}</th>] : [head];
              })}
              <th className={thc}><span className="sr-only">{t("interviews.col.actions")}</span></th>
            </tr></thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.id} data-testid="interview-row" data-worker={w.id} data-status={w.status}>
                  <th scope="row" className={`${tdc} cjk-phrase sticky left-0 z-10 min-w-48 bg-card font-medium`}><Link href={`/candidates/${w.id}`} className="text-accent-text hover:underline">{w.fullName}</Link>{w.status === "ENDED" && w.endDate && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-800" data-testid="worker-ended">{t("interviews.endedOn", { date: w.endDate.replace(/-/g, "/") })}</span>} <Link href={`/records/workers/${w.id}`} className="ml-1 inline-flex min-h-11 items-center text-xs font-normal text-ink-2 underline hover:text-accent-text" data-testid="interview-worker-history">{t("whistory.historyLink")}</Link></th>
                  <td className={`${gridTdText} min-w-28`}>{(locale === "ja" ? w.fieldNameJa : w.fieldNameId) ?? "—"}</td>
                  <td className={`${tdc} whitespace-nowrap`}>{w.startDate.replace(/-/g, "/")}</td>
                  <td className={`${gridTdText} min-w-44`}>{w.companyName}<div className="text-xs text-ink-2">{w.siteName}</div></td>
                  <td className={`${gridTdText} min-w-28`} data-testid="grid-responsible" data-staff={respOf.get(w.id)?.staffId ?? ""}>{respOf.get(w.id)?.staffId ? respName.get(respOf.get(w.id)!.staffId!) ?? "—" : <span className="text-ink-2">—</span>}</td>
                  <td className={`${gridTdText} min-w-64`}>{w.siteAddress ?? "—"}</td>
                  <td className={`${tdc} whitespace-nowrap`}>{w.sitePhone ?? "—"}</td>
                  <td className={`${gridTdText} min-w-32`}>{w.contacts[0] ? <>{w.contacts[0].name}<div className="whitespace-nowrap text-xs text-ink-2">{w.contacts[0].phone ?? ""}</div></> : "—"}</td>
                  {months.flatMap((m, i) => {
                    const st = markOf(w, m);
                    const cell = (
                      <td key={m} className={`${tdc} ${m === month ? "bg-accent-soft/40" : ""}`} data-state={st} data-month={m} data-testid="interview-cell">
                        {st === "notDue" ? <span className="text-ink-2">—</span> : (
                          <Link href={`/records/interviews/${w.id}/${m}`} className="inline-flex min-h-11 flex-col justify-center hover:underline" data-testid="interview-cell-link">
                            {st === "none" ? <span className="text-xs text-ink-2">{t("interviews.state.none")}</span> : <span><span aria-hidden>{ICON[st]}</span> {t(`interviews.state.${st}`)}</span>}
                            {st === "done" && <span className="text-xs text-ink-2">{resultLabel(w.id, m)}</span>}
                          </Link>
                        )}
                      </td>
                    );
                    if (i % 3 !== 2) return [cell];
                    const q = quarterOfMonth(m);
                    const qs = quarterStateOf(w.id, q);
                    return [cell, (
                      <td key={`q${i}`} className={tdc} data-testid="quarter-cell" data-quarter={q}>
                        <p className={`mb-1 text-sm font-semibold ${qs === "missed" ? "text-rose-800" : qcell(w.id, q)?.urgent ? "rounded bg-amber-50 px-1 text-amber-900" : ""}`} data-testid="quarter-state" data-state={qs} data-urgent={qcell(w.id, q)?.urgent ? "true" : undefined}>
                          {qs === "notRequired" || qs === "notDue" ? <span className="font-normal text-ink-2">—</span> : <><span aria-hidden>{ICON[qs]}</span> {qs === "open" ? t("interviews.qstate.open", { date: (qcell(w.id, q)?.deadline ?? "").replace(/-/g, "/") }) : t(`interviews.qstate.${qs}`)}{qs === "done" && <span className="font-normal text-ink-2"> ({t("interviews.countInQuarter", { n: quarterCountOf(w.id, q) })})</span>}</>}
                        </p>
                        <details>
                          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs">
                            <span lang="ja" className="min-w-0 flex-1 whitespace-pre-wrap break-words">{noteOf(w.id, q) || "—"}</span>
                            <span className="shrink-0 whitespace-nowrap font-semibold text-accent-text">{t("interviews.editQuarter")}</span>
                          </summary>
                          <ActionForm action={saveQuarterNote} hidden={{ candidateId: w.id, fiscalYear: String(fy), quarter: String(q) }} submitLabel={t("f.save")} submitTone="secondary" className="w-52 space-y-1">
                            <label className="sr-only" htmlFor={`qn-${w.id}-${q}`}>{t("interviews.quarterNote", { q })}</label>
                            <textarea id={`qn-${w.id}-${q}`} name="note" defaultValue={noteOf(w.id, q)} rows={3} lang="ja" maxLength={4000} className={`${inputClass} py-2`} />
                          </ActionForm>
                        </details>
                      </td>
                    )];
                  })}
                  <td className={`${tdc} whitespace-nowrap`}><a href={`/records/export/interview/${w.id}?fy=${fy}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline" data-testid="export-interview">{t("export.interview")}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
