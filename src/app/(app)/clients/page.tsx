import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, cardClass, inputClass } from "@/components/styles";
import { listCompanies } from "@/features/clients/queries";
import { requireTsk } from "@/features/clients/guards";
import { getSkillFieldOptions } from "@/features/skill-fields/server";
import { tenantQuery } from "@/lib/session";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** Klien (配属先): perusahaan (法人) dengan lokasinya. Hanya TSK; LPK mendapat 404. */
export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireTsk();
  const t = await getTranslations("clients");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const includeInactive = one(sp.inactive) === "1";
  const [companies, skill] = await Promise.all([tenantQuery((tx) => listCompanies(tx, { q, includeInactive })), getSkillFieldOptions()]);
  const label = new Map(skill.map((s) => [s.id, s.label]));

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
        action={<Link href="/clients/new" className={btnPrimary} data-testid="company-add">+ {t("addCompany")}</Link>}
      />
      {sp.deleted && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="client-deleted">{t("deleted")}</p>
      )}
      <form method="get" action="/clients" className={`${cardClass} mb-4 flex flex-wrap items-end gap-3 p-4`} data-testid="client-search" key={`${q}|${includeInactive}`}>
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor="q" className="block text-sm font-medium text-stone-700">{t("search")}</label>
          <input id="q" name="q" defaultValue={q} maxLength={100} placeholder={t("searchPlaceholder")} className={inputClass} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} className="h-4 w-4 rounded border-stone-300" /> {t("showInactive")}
        </label>
        <button type="submit" className={btnPrimary}>{t("apply")}</button>
        {(q || includeInactive) && <Link href="/clients" className={btnSecondary}>{t("reset")}</Link>}
      </form>

      {companies.length === 0 ? (
        <div className={`${cardClass} p-8 text-center text-sm text-stone-500`} data-testid="client-empty">{q ? t("noMatch") : t("empty")}</div>
      ) : (
        <ul className="space-y-4" data-testid="company-list">
          {companies.map((c) => (
            <li key={c.id} className={`${cardClass} p-4 sm:p-5`} data-testid="company-card" data-active={c.active}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/clients/${c.id}`} translate="no" className="text-lg font-semibold text-brand-700 hover:underline" data-testid="company-name">{c.name}</Link>
                  {c.nameAlt && <span translate="no" className="ml-2 text-sm text-stone-500">{c.nameAlt}</span>}
                  {!c.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">{t("inactive")}</span>}
                </div>
                <Link href={`/clients/${c.id}/sites/new`} className="text-sm font-medium text-brand-700 hover:underline">+ {t("addSite")}</Link>
              </div>
              {c.sites.length === 0 ? (
                <p className="mt-2 text-sm text-stone-500">{t("noSites")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-100">
                  {c.sites.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="site-row">
                      <div>
                        <Link href={`/clients/${c.id}/sites/${s.id}`} translate="no" className="font-medium hover:underline">{s.name}</Link>
                        {!s.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">{t("inactive")}</span>}
                        {s.address && <p translate="no" className="text-xs text-stone-500">{s.address}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {s.fieldIds.map((id) => (
                          <span key={id} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">{label.get(id) ?? "—"}</span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
