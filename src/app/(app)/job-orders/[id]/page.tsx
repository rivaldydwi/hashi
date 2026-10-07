import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { skillFieldName } from "@/db/skill-fields";
import { matchCandidates } from "@/db/job-matching";
import { ExportJobOrderSheet } from "@/features/client-sheet/ExportSheet";
import { DecisionBadge } from "@/components/DecisionBadge";
import { PageHeader } from "@/components/PageHeader";
import { cardClass, tableHeadClass } from "@/components/styles";
import { toFormValue } from "@/features/candidates/sections";
import { requireTsk, uuid } from "@/features/clients/guards";
import { JOB_ORDER_ALL_FIELDS } from "@/features/job-orders/fields";
import { DeleteJobOrder, JobOrderForm, ProposeButton, StatusButtons } from "@/features/job-orders/JobOrderForms";
import { getJobOrder } from "@/features/job-orders/queries";
import { formatAvg } from "@/features/assessments/fields";
import { tenantQuery } from "@/lib/session";
import { STATUS_STYLE } from "@/features/job-orders/status";

export const metadata: Metadata = { title: "Job order" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const Flag = ({ ok, label, testid }: { ok: boolean | null; label: string; testid: string }) =>
  ok === null ? null : (
    <span data-testid={testid} data-ok={ok} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );

export default async function JobOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const me = await requireTsk();
  const { id } = await params;
  const sp = await searchParams;
  if (!uuid.safeParse(id).success) notFound();
  const data = await tenantQuery((tx) => getJobOrder(tx, id));
  if (!data) notFound(); // tidak ada, atau milik TSK lain (RLS)
  const t = await getTranslations("jobOrders");
  const locale = await getLocale();
  const { jo } = data;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) === "match" ? "match" : "detail";
  const values = Object.fromEntries(JOB_ORDER_ALL_FIELDS.map((f) => [f.name, toFormValue(f, (jo as Record<string, unknown>)[f.name])]));
  const matches = tab === "match" ? await tenantQuery((tx) => matchCandidates(tx, jo, me.organizationId)) : [];

  const tabClass = (active: boolean) => `rounded-lg px-4 py-2 text-sm font-medium ${active ? "bg-stone-900 text-white" : "bg-white text-stone-700 border border-stone-300 hover:bg-stone-100"}`;
  return (
    <>
      <PageHeader
        title={jo.title}
        titleIsData
        intro={`${data.companyName} / ${data.siteName} · ${skillFieldName({ nameId: data.fieldNameId, nameJa: data.fieldNameJa }, locale)}`}
        backHref="/job-orders"
        backLabel={t("title")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[jo.status]}`} data-testid="job-order-status">{t(`status.${jo.status}`)} · {data.selected} / {jo.positions}</span>
            <Suspense fallback={null}><ExportJobOrderSheet me={me} jobOrderId={jo.id} /></Suspense>
          </div>
        }
      />
      <nav className="mb-4 flex gap-2" aria-label="tabs">
        <Link href={`/job-orders/${id}`} className={tabClass(tab === "detail")} data-testid="tab-detail">{t("tabDetail")}</Link>
        <Link href={`/job-orders/${id}?tab=match`} className={tabClass(tab === "match")} data-testid="tab-match">{t("tabMatch")}</Link>
      </nav>

      {tab === "detail" ? (
        <div className="space-y-4">
          <section className={`${cardClass} p-5`} data-testid="section-job-order">
            <h2 className="mb-3 font-medium">{t("details")}</h2>
            <JobOrderForm siteId={jo.siteId} jobOrder={{ id: jo.id, values }} siteFieldIds={data.siteFieldIds} />
          </section>
          <section className={`${cardClass} space-y-3 p-5`}>
            <h2 className="font-medium">{t("statusTitle")}</h2>
            <p className="text-sm text-stone-600">{t("statusHint")}</p>
            <StatusButtons jobOrderId={jo.id} status={jo.status} />
            {me.role === "TSK_ADMIN" && <DeleteJobOrder jobOrderId={jo.id} />}
          </section>
        </div>
      ) : (
        <section className={`${cardClass} overflow-hidden`} data-testid="section-match">
          <p className="px-5 pt-4 text-sm text-stone-600">{t("matchIntro")}</p>
          {matches.length === 0 ? (
            <p className="p-5 text-sm text-stone-500" data-testid="match-empty">{t("matchEmpty")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="match-table">
                <thead className={tableHeadClass}>
                  <tr>
                    <th className="px-5 py-2 font-medium">{t("colCandidate")}</th>
                    <th className="px-5 py-2 font-medium">{t("colRequirements")}</th>
                    <th className="px-5 py-2 font-medium">{t("colAvg")}</th>
                    <th className="px-5 py-2 font-medium">{t("colDecision")}</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {matches.map((c) => (
                    <tr key={c.id} data-testid="match-row" data-candidate={c.fullName}>
                      <td translate="no" className="cjk-phrase min-w-40 px-5 py-3">
                        <Link href={`/candidates/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.fullName}</Link>
                        <div className="text-xs text-stone-500">{c.lpkName}</div>
                      </td>
                      <td className="cjk-phrase min-w-40 px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Flag ok={c.jlptOk} label={t("reqJlpt", { level: jo.minJlpt ?? "" })} testid="flag-jlpt" />
                          <Flag ok={c.jftOk} label={t("reqJft")} testid="flag-jft" />
                          <Flag ok={c.genderOk} label={t(`reqGender.${jo.genderRequirement ?? "MALE"}`)} testid="flag-gender" />
                          {c.jlptOk === null && c.jftOk === null && c.genderOk === null && <span className="text-xs text-stone-500">{t("noRequirements")}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 tabular-nums" data-testid="match-avg">{formatAvg(c.latestAvg)}</td>
                      <td className="px-5 py-3">
                        {c.forThisJobOrder ? <span data-testid="match-this"><DecisionBadge decision={c.forThisJobOrder} /></span> : c.headline ? <span className="text-xs text-stone-500"><DecisionBadge decision={c.headline} /></span> : <span className="text-xs text-stone-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {c.placed ? (
                          <span className="text-xs text-stone-500" data-testid="match-placed">{t("alreadyPlaced")}</span>
                        ) : c.forThisJobOrder && ["SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"].includes(c.forThisJobOrder) ? (
                          <span className="text-xs font-medium text-emerald-700" data-testid="match-proposed">{t("proposed")}</span>
                        ) : jo.status === "OPEN" ? (
                          <ProposeButton jobOrderId={jo.id} candidateId={c.id} />
                        ) : (
                          <span className="text-xs text-stone-400">{t("notOpen")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
