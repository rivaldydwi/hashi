import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { currentAssignment } from "@/db/responsibility";
import { companiesBasic, responsibilityOverview } from "@/db/responsibility-queries";
import { WORKLOAD } from "@/db/workload-config";
import { requireStaff } from "@/features/records/access";
import { setResponsible } from "@/features/records/responsible-actions";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { Badge, type Tone } from "@/features/records/ui/common";
import { dateTimeIn, safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVEL_TONE: Record<"ok" | "warn" | "over", Tone> = { ok: "ok", warn: "warn", over: "danger" };
const LEVEL_ICON = { ok: "✓", warn: "⚠", over: "⛔" } as const;

/**
 * Penanggung jawab pekerja (担当/責任者) dan beban kerja (T-010). Penanggung jawab per perusahaan klien (bawaan) dan per pekerja (menimpa); satu staf maksimal 50 pekerja mulai April 2027:
 * HANYA peringatan (kuning >= 45, merah > 50), tidak memblokir. Semua staf TSK membaca; mengubah hanya TSK_ADMIN.
 */
export default async function ResponsiblePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const t = await getTranslations("responsible");
  const tr = await getTranslations("records");
  const troles = await getTranslations("roles");
  const locale = await getLocale();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const isAdmin = me.role === "TSK_ADMIN";
  const view = one(sp.view) === "over" ? "over" : one(sp.view) === "unassigned" ? "unassigned" : "";
  const staffF = UUID.test(one(sp.staff)) ? one(sp.staff) : "";
  const mine = one(sp.mine) === "1";

  const data = await tenantQuery(async (tx) => ({ ov: await responsibilityOverview(tx, today), companies: await companiesBasic(tx) }));
  const { ov, companies } = data;
  const staffName = new Map(ov.staff.map((s) => [s.id, s.name]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const workerOfPlacement = new Map(ov.workers.map((w) => [w.placementId, w.fullName]));
  const overIds = new Set(ov.overLimit.map((s) => s.id));
  const focusStaff = mine ? me.id : staffF;

  const workload = view === "over" ? ov.workload.filter((x) => overIds.has(x.staff.id)) : ov.workload;
  const shownWorkers = ov.workers
    .filter((w) => (focusStaff ? w.responsible.staffId === focusStaff : true))
    .filter((w) => (view === "over" ? !!w.responsible.staffId && overIds.has(w.responsible.staffId) : true))
    .filter((w) => (view === "unassigned" ? w.status === "ACTIVE" && !w.responsible.staffId : true));
  const hrefFor = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, staff: staffF, mine: mine ? "1" : "", ...over })) if (v) p.set(k, v);
    return p.toString() ? `/records/responsible?${p}` : "/records/responsible";
  };
  const staffOptions = (_selected: string, blank: string) => (
    <>
      <option value="">{blank}</option>
      {ov.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </>
  );
  const nearOrOver = ov.workload.filter((x) => x.level !== "ok");

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-[19px] font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-ink-2">{t("intro")}</p>
      </header>

      <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="note" data-testid="workload-rule">
        {t("rule", { max: WORKLOAD.max, warnAt: WORKLOAD.warnAt, date: WORKLOAD.effectiveFrom.replace(/-/g, "/") })}
      </p>

      {(view || focusStaff) && (
        <ul className="flex flex-wrap gap-2" data-testid="filter-chips" aria-label={tr("filters.active")}>
          {view && <li data-testid="filter-chip" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">{t(`view.${view}`)}<Link href={hrefFor({ view: "" })} aria-label={tr("filters.remove", { name: t(`view.${view}`) })} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10">×</Link></li>}
          {focusStaff && <li data-testid="filter-chip" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-accent-soft pl-4 text-sm font-medium text-accent-text">{mine ? t("filter.mine") : staffName.get(focusStaff) ?? "—"}<Link href={hrefFor({ staff: "", mine: "" })} aria-label={tr("filters.remove", { name: t("filter.mine") })} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent/10">×</Link></li>}
        </ul>
      )}

      {view !== "unassigned" && (
        <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="wl-title" data-testid="workload">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="wl-title" className="text-[16px] font-semibold">{t("workload.title")}</h3>
            <span className="flex gap-2 text-sm"><Link href={hrefFor({ mine: "1", staff: "" })} className={btnSecondary} data-testid="filter-mine">{t("filter.mine")}</Link></span>
          </div>
          {nearOrOver.length > 0 && (
            <ul className="mt-3 space-y-1" data-testid="workload-warnings">
              {nearOrOver.map((x) => (
                <li key={x.staff.id} role="status" className={`rounded-lg px-3 py-2 text-sm ${x.level === "over" ? "bg-rose-50 text-rose-950" : "bg-amber-50 text-amber-950"}`} data-testid="workload-warning" data-level={x.level}>
                  {LEVEL_ICON[x.level]} {t(x.level === "over" ? "warning.over" : "warning.warn", { name: x.staff.name, n: x.count, max: WORKLOAD.max, date: WORKLOAD.effectiveFrom.replace(/-/g, "/") })}
                </li>
              ))}
            </ul>
          )}
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left text-sm" data-testid="workload-table">
              <thead><tr className="text-xs text-ink-2"><th className="py-2 pr-3 font-semibold">{t("col.staff")}</th><th className="py-2 pr-3 font-semibold">{t("col.count")}</th><th className="py-2 pr-3 font-semibold">{t("col.level")}</th><th className="py-2"><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
              <tbody className="divide-y divide-line">
                {workload.map((x) => (
                  <tr key={x.staff.id} data-testid="workload-row" data-staff={x.staff.id} data-count={x.count} data-level={x.level}>
                    <th scope="row" className="py-2 pr-3 font-medium">{x.staff.name} <span className="text-xs font-normal text-ink-2">{troles(x.staff.role as "TSK_ADMIN" | "TSK_STAFF")}</span></th>
                    <td className="py-2 pr-3 tabular-nums" data-testid="workload-count">{x.count} / {WORKLOAD.max}</td>
                    <td className="py-2 pr-3"><Badge tone={LEVEL_TONE[x.level]} testId="workload-level">{LEVEL_ICON[x.level]} {t(`level.${x.level}`)}</Badge></td>
                    <td className="py-2"><Link href={hrefFor({ staff: x.staff.id, mine: "" })} className="inline-flex min-h-11 items-center text-sm font-medium text-accent-text hover:underline">{t("viewWorkers")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view === "over" && workload.length === 0 && <p className="mt-3 text-sm text-ink-2" data-testid="over-none">{t("noneOver")}</p>}
        </section>
      )}

      {view !== "over" && (
        <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="un-title" data-testid="unassigned">
          <h3 id="un-title" className="text-[16px] font-semibold">{t("unassigned.title")} <span className="text-sm font-normal text-ink-2" data-testid="unassigned-count">({ov.unassigned.length})</span></h3>
          {ov.unassigned.length === 0 ? <p className="mt-2 text-sm text-ink-2" data-testid="unassigned-none">{t("unassigned.none")}</p> : (
            <ul className="mt-2 divide-y divide-line" data-testid="unassigned-list">
              {ov.unassigned.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-testid="unassigned-item" data-worker={w.id}>
                  <Link href={`/records/workers/${w.id}`} className="font-medium text-accent-text hover:underline">{w.fullName}</Link>
                  <span className="text-xs text-ink-2">{w.companyName}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!view && (
        <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="co-title" data-testid="companies">
          <h3 id="co-title" className="text-[16px] font-semibold">{t("companies.title")}</h3>
          <p className="mt-1 text-xs text-ink-2">{t("companies.hint")}</p>
          <ul className="mt-2 divide-y divide-line">
            {companies.filter((c) => c.active).map((c) => {
              const cur = currentAssignment(ov.assignments.byCompany.get(c.id) ?? [], today);
              return (
                <li key={c.id} className="py-3" data-testid="company-row" data-company={c.id}>
                  <p className="text-sm font-medium">{c.name} <span className="font-normal text-ink-2" data-testid="company-current">— {cur?.staffId ? staffName.get(cur.staffId) ?? "—" : t("none")}</span></p>
                  {isAdmin ? (
                    <ActionForm action={setResponsible} hidden={{ scope: "company", targetId: c.id }} submitLabel={t("save")} submitTone="secondary" className="mt-2 grid items-end gap-2 sm:grid-cols-[1fr_11rem_auto]" testId="company-form">
                      <div className="space-y-1"><label className={labelClass} htmlFor={`co-${c.id}`}>{t("form.staff")}</label><select id={`co-${c.id}`} name="staffId" className={inputClass} defaultValue={cur?.staffId ?? ""}>{staffOptions(cur?.staffId ?? "", t("none"))}</select></div>
                      <div className="space-y-1"><label className={labelClass} htmlFor={`cod-${c.id}`}>{t("form.effectiveFrom")}</label><input id={`cod-${c.id}`} name="effectiveFrom" type="date" defaultValue={today} className={inputClass} /></div>
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {view !== "over" || shownWorkers.length > 0 ? (
        view === "unassigned" ? null : (
          <section aria-labelledby="wk-title" data-testid="workers">
            <h3 id="wk-title" className="mb-2 text-[16px] font-semibold">{t("workers.title")} <span className="text-sm font-normal text-ink-2" data-testid="workers-count">({shownWorkers.length})</span></h3>
            {shownWorkers.length === 0 ? <EmptyState testId="workers-empty" title={t("workers.emptyTitle")} body={t("workers.emptyBody")} /> : (
              <ul className={`${cardClass} divide-y divide-line`}>
                {shownWorkers.map((w) => (
                  <li key={w.id} className="px-4 py-3" data-testid="worker-row" data-worker={w.id} data-company={w.companyId} data-status={w.status} data-responsible={w.responsible.staffId ?? ""} data-source={w.responsible.source}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link href={`/records/workers/${w.id}`} className="font-medium text-accent-text hover:underline">{w.fullName}</Link>
                      <span className="text-xs text-ink-2">{w.companyName}</span>
                      {w.status === "ENDED" && <Badge testId="worker-ended">{tr("interviews.endedOn", { date: (w.endDate ?? "").replace(/-/g, "/") })}</Badge>}
                      <span className="ml-auto text-sm" data-testid="worker-effective">{w.responsible.staffId ? staffName.get(w.responsible.staffId) : <Badge tone="warn">{t("none")}</Badge>}</span>
                      {w.responsible.staffId && <Badge tone={w.responsible.source === "placement" ? "info" : "neutral"} testId="worker-source">{t(`source.${w.responsible.source}`)}</Badge>}
                    </div>
                    {isAdmin && w.status === "ACTIVE" && (
                      <ActionForm action={setResponsible} hidden={{ scope: "placement", targetId: w.placementId }} submitLabel={t("save")} submitTone="secondary" className="mt-2 grid items-end gap-2 sm:grid-cols-[1fr_11rem_auto]" testId="worker-form">
                        <div className="space-y-1"><label className={labelClass} htmlFor={`wk-${w.id}`}>{t("form.workerStaff")}</label><select id={`wk-${w.id}`} name="staffId" className={inputClass} defaultValue={w.responsible.source === "placement" ? (w.responsible.staffId ?? "") : ""}>{staffOptions(w.responsible.source === "placement" ? (w.responsible.staffId ?? "") : "", t("followCompany"))}</select></div>
                        <div className="space-y-1"><label className={labelClass} htmlFor={`wkd-${w.id}`}>{t("form.effectiveFrom")}</label><input id={`wkd-${w.id}`} name="effectiveFrom" type="date" defaultValue={today} className={inputClass} /></div>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      ) : null}

      {!view && (
        <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="hs-title" data-testid="history">
          <h3 id="hs-title" className="text-[16px] font-semibold">{t("history.title")}</h3>
          {ov.assignments.history.length === 0 ? <p className="mt-2 text-sm text-ink-2">{t("history.empty")}</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {ov.assignments.history.slice(0, 30).map((h) => (
                <li key={h.id} className="py-2" data-testid="history-item" data-scope={h.scope}>
                  <span className="text-xs text-ink-2">{dateTimeIn(h.createdAt, locale, tz)}</span> · <Badge>{t(`scope.${h.scope}`)}</Badge>{" "}
                  <span className="font-medium">{h.scope === "company" ? companyName.get(h.targetId) ?? "—" : workerOfPlacement.get(h.targetId) ?? "—"}</span>{" → "}
                  <span>{h.staffId ? staffName.get(h.staffId) ?? "—" : h.scope === "company" ? t("none") : t("followCompany")}</span>{" "}
                  <span className="text-xs text-ink-2">({t("history.from", { date: h.effectiveFrom.replace(/-/g, "/") })}; {staffName.get(h.createdBy) ?? "—"})</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
