import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, cardClass } from "@/components/styles";
import { requireTsk, uuid } from "@/features/clients/guards";
import { JobOrderForm } from "@/features/job-orders/JobOrderForms";
import { listSiteOptions } from "@/features/job-orders/queries";
import { getSkillFieldOptions } from "@/features/skill-fields/server";
import { tenantQuery } from "@/lib/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Langkah 1: pilih lokasi kerja. Langkah 2 (?site=...): form job order dengan bidang yang dibatasi ke bidang yang diterima lokasi. */
export default async function NewJobOrderPage({ searchParams }: { searchParams: SearchParams }) {
  await requireTsk();
  const t = await getTranslations("jobOrders");
  const sp = await searchParams;
  const siteParam = Array.isArray(sp.site) ? sp.site[0] : sp.site;
  const [sites, skill] = await Promise.all([tenantQuery((tx) => listSiteOptions(tx)), getSkillFieldOptions()]);
  const site = siteParam && uuid.safeParse(siteParam).success ? sites.find((s) => s.id === siteParam) : undefined;
  const label = new Map(skill.map((s) => [s.id, s.label]));

  return (
    <>
      <PageHeader title={t("newTitle")} intro={site ? `${site.companyName} / ${site.name}` : t("chooseSiteIntro")} backHref={site ? "/job-orders/new" : "/job-orders"} backLabel={site ? t("chooseSite") : t("title")} />
      {site ? (
        site.fieldIds.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="site-no-fields">{t("siteHasNoFields")}</p>
        ) : (
          <div className={`${cardClass} max-w-3xl p-5`}>
            <JobOrderForm siteId={site.id} siteFieldIds={site.fieldIds} />
          </div>
        )
      ) : sites.length === 0 ? (
        <div className={`${cardClass} p-8 text-center text-sm text-stone-500`} data-testid="no-sites">
          {t("noSites")} <Link href="/clients" className="font-medium text-brand-700 hover:underline">{t("goClients")}</Link>
        </div>
      ) : (
        <ul className={`${cardClass} divide-y divide-stone-100`} data-testid="site-chooser">
          {sites.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="site-option">
              <div>
                <div className="font-medium">{s.companyName}</div>
                <div className="text-sm text-stone-600">{s.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.fieldIds.map((id) => (
                    <span key={id} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">{label.get(id) ?? "—"}</span>
                  ))}
                </div>
              </div>
              <Link href={`/job-orders/new?site=${s.id}`} className={btnPrimary} data-testid="site-choose">{t("useSite")}</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
