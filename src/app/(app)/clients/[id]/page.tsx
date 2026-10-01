import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, cardClass } from "@/components/styles";
import { ActiveToggle, CompanyForm, DeleteButton } from "@/features/clients/ClientForms";
import { COMPANY_FIELDS } from "@/features/clients/fields";
import { requireTsk, uuid } from "@/features/clients/guards";
import { getCompany } from "@/features/clients/queries";
import { toFormValue } from "@/features/candidates/sections";
import { tenantQuery } from "@/lib/session";

export const metadata: Metadata = { title: "Client" };
export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTsk();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const data = await tenantQuery((tx) => getCompany(tx, id));
  if (!data) notFound(); // tidak ada, atau milik TSK lain (RLS)
  const t = await getTranslations("clients");
  const { company, sites } = data;
  const values = Object.fromEntries(COMPANY_FIELDS.map((f) => [f.name, toFormValue(f, (company as Record<string, unknown>)[f.name])]));

  return (
    <>
      <PageHeader
        title={company.name}
        intro={company.nameAlt ?? undefined}
        backHref="/clients"
        backLabel={t("title")}
        action={!company.active ? <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-medium text-stone-700">{t("inactive")}</span> : undefined}
      />
      <div className="space-y-4">
        <section className={`${cardClass} p-5`} data-testid="section-company">
          <h2 className="mb-3 font-medium">{t("companyDetails")}</h2>
          <CompanyForm company={{ id: company.id, values }} />
        </section>

        <section className={`${cardClass} p-5`} data-testid="section-sites">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{t("sitesTitle")}</h2>
            <Link href={`/clients/${company.id}/sites/new`} className={btnPrimary} data-testid="site-add">+ {t("addSite")}</Link>
          </div>
          {sites.length === 0 ? (
            <p className="text-sm text-stone-500">{t("noSites")}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {sites.map((s) => (
                <li key={s.id} className="py-2" data-testid="site-row">
                  <Link href={`/clients/${company.id}/sites/${s.id}`} className="font-medium text-brand-700 hover:underline">{s.name}</Link>
                  {!s.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">{t("inactive")}</span>}
                  {s.address && <p className="text-xs text-stone-500">{s.address}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardClass} space-y-3 p-5`} data-testid="section-company-status">
          <h2 className="font-medium">{t("statusTitle")}</h2>
          <ActiveToggle kind="company" hidden={{ companyId: company.id }} active={company.active} />
          {me.role === "TSK_ADMIN" && <DeleteButton kind="company" hidden={{ companyId: company.id }} warning={t("deleteCompanyWarning")} />}
        </section>
      </div>
    </>
  );
}
