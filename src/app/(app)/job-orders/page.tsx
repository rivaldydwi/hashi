import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, cardClass, inputClass, tableHeadClass } from "@/components/styles";
import { jobOrderStatus, type JobOrderStatus } from "@/db/schema";
import { requireTsk } from "@/features/clients/guards";
import { STATUS_STYLE } from "@/features/job-orders/status";
import { listJobOrders } from "@/features/job-orders/queries";
import { tenantQuery } from "@/lib/session";

export const metadata: Metadata = { title: "Job orders" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export default async function JobOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireTsk();
  const t = await getTranslations("jobOrders");
  const locale = await getLocale();
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const status = (jobOrderStatus.enumValues as readonly string[]).includes(one(sp.status)) ? (one(sp.status) as JobOrderStatus) : "";
  const rows = await tenantQuery((tx) => listJobOrders(tx, { q, status }));

  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      {sp.deleted && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="job-order-deleted">{t("deleted")}</p>}
      <form method="get" action="/job-orders" key={`${q}|${status}`} className={`${cardClass} mb-4 flex flex-wrap items-end gap-3 p-4`}>
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor="q" className="block text-sm font-medium text-stone-700">{t("search")}</label>
          <input id="q" name="q" defaultValue={q} maxLength={100} placeholder={t("searchPlaceholder")} className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="status" className="block text-sm font-medium text-stone-700">{t("filterStatus")}</label>
          <select id="status" name="status" defaultValue={status} className={inputClass}>
            <option value="">{t("all")}</option>
            {jobOrderStatus.enumValues.map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
        </div>
        <button type="submit" className={btnPrimary}>{t("apply")}</button>
        {(q || status) && <Link href="/job-orders" className={btnSecondary}>{t("reset")}</Link>}
      </form>

      {rows.length === 0 ? (
        <div className={`${cardClass} p-8 text-center text-sm text-stone-500`} data-testid="job-order-empty">{q || status ? t("noMatch") : t("empty")}</div>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="job-order-table">
              <thead className={tableHeadClass}>
                <tr>
                  <th className="px-5 py-2 font-medium">{t("colTitle")}</th>
                  <th className="px-5 py-2 font-medium">{t("colSite")}</th>
                  <th className="px-5 py-2 font-medium">{t("colField")}</th>
                  <th className="px-5 py-2 font-medium">{t("colSelected")}</th>
                  <th className="px-5 py-2 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((r) => (
                  <tr key={r.id} data-testid="job-order-row" data-status={r.status}>
                    <td className="cjk-phrase min-w-48 px-5 py-3">
                      <Link href={`/job-orders/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.title}</Link>
                      {r.applicationDeadline && <div className="text-xs text-stone-500">{t("deadline")}: {r.applicationDeadline}</div>}
                    </td>
                    <td className="cjk-phrase min-w-44 px-5 py-3"><div>{r.companyName}</div><div className="text-xs text-stone-500">{r.siteName}</div></td>
                    <td className="cjk-phrase min-w-28 px-5 py-3">{locale === "ja" ? r.fieldNameJa : r.fieldNameId}</td>
                    <td className="px-5 py-3 tabular-nums" data-testid="job-order-selected">{r.selected} / {r.positions}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{t(`status.${r.status}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
