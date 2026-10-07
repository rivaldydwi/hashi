import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { skillFieldName } from "@/db/skill-fields";
import { PageHeader } from "@/components/PageHeader";
import { cardClass } from "@/components/styles";
import { ExportCompanySheet } from "@/features/client-sheet/ExportSheet";
import { ActiveToggle, ContactForm, DeleteButton, SiteForm } from "@/features/clients/ClientForms";
import { CONTACT_FIELDS, SITE_ALL_FIELDS } from "@/features/clients/fields";
import { requireTsk, uuid } from "@/features/clients/guards";
import { getSite } from "@/features/clients/queries";
import { jobOrdersForSite } from "@/features/job-orders/queries";
import { STATUS_STYLE } from "@/features/job-orders/status";
import { toFormValue } from "@/features/candidates/sections";
import { tenantQuery } from "@/lib/session";

export const metadata: Metadata = { title: "Site" };
export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ id: string; siteId: string }> }) {
  const me = await requireTsk();
  const { id, siteId } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(siteId).success) notFound();
  const data = await tenantQuery((tx) => getSite(tx, siteId));
  if (!data || data.company.id !== id) notFound();
  const t = await getTranslations("clients");
  const tj = await getTranslations("jobOrders");
  const jobs = await tenantQuery((tx) => jobOrdersForSite(tx, siteId));
  const locale = await getLocale();
  const { site, company, fields, contacts } = data;
  const siteValues = Object.fromEntries(SITE_ALL_FIELDS.map((f) => [f.name, toFormValue(f, (site as Record<string, unknown>)[f.name])]));
  const contactValues = (c: (typeof contacts)[number]) => Object.fromEntries(CONTACT_FIELDS.map((f) => [f.name, toFormValue(f, (c as Record<string, unknown>)[f.name])]));

  return (
    <>
      <PageHeader
        title={site.name}
        titleIsData
        intro={company.name}
        introIsData
        backHref={`/clients/${company.id}`}
        backLabel={company.name}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!site.active && <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-medium text-stone-700">{t("inactive")}</span>}
            {site.active && <Suspense fallback={null}><ExportCompanySheet me={me} companyId={company.id} siteId={site.id} /></Suspense>}
          </div>
        }
      />
      <div className="space-y-4">
        <section className={`${cardClass} p-5`} data-testid="section-site">
          <h2 className="mb-1 font-medium">{t("siteDetails")}</h2>
          <p className="mb-3 flex flex-wrap gap-1 text-xs text-stone-500" data-testid="site-field-chips">
            {fields.length === 0 ? t("noFields") : fields.map((f) => (
              <span key={f.id} className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-800">{skillFieldName(f, locale)}</span>
            ))}
          </p>
          <SiteForm companyId={company.id} site={{ id: site.id, values: siteValues, fieldIds: fields.map((f) => f.id) }} />
        </section>

        <section className={`${cardClass} p-5`} data-testid="section-contacts">
          <h2 className="mb-3 font-medium">{t("contactsTitle")}</h2>
          {contacts.length === 0 ? (
            <p className="mb-3 text-sm text-stone-500" data-testid="no-contacts">{t("noContacts")}</p>
          ) : (
            <ul className="mb-4 space-y-3">
              {contacts.map((c) => (
                <li key={c.id} className="rounded-xl border border-stone-200 p-3" data-testid="contact" data-active={c.active}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {c.roleTitle && <span className="mr-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs">{c.roleTitle}</span>}
                      <span translate="no" className="font-medium" data-testid="contact-name">{c.name}</span>
                      {c.phone && <span translate="no" className="ml-2 text-stone-600">{c.phone}</span>}
                      {!c.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">{t("inactive")}</span>}
                    </span>
                  </div>
                  <details className="mt-2 border-t border-stone-100 pt-2 text-sm">
                    <summary className="cursor-pointer font-medium text-brand-700">{t("edit")}</summary>
                    <div className="space-y-3 pt-3">
                      <ContactForm companyId={company.id} siteId={site.id} contact={{ id: c.id, values: contactValues(c) }} />
                      <ActiveToggle kind="contact" hidden={{ contactId: c.id, siteId: site.id, companyId: company.id }} active={c.active} />
                      {me.role === "TSK_ADMIN" && <DeleteButton kind="contact" hidden={{ contactId: c.id, siteId: site.id, companyId: company.id }} warning={t("deleteContactWarning")} />}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <details className="rounded-lg border border-stone-200 p-3" open={contacts.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-brand-700" data-testid="contact-add-toggle">+ {t("addContact")}</summary>
            <div className="pt-3"><ContactForm companyId={company.id} siteId={site.id} /></div>
          </details>
        </section>

        <section className={`${cardClass} p-5`} data-testid="section-site-job-orders">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{tj("title")}</h2>
            {site.active && fields.length > 0 && <Link href={`/job-orders/new?site=${site.id}`} className="text-sm font-medium text-brand-700 hover:underline">+ {tj("add")}</Link>}
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-stone-500">{tj("empty")}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2 py-2" data-testid="site-job-order">
                  <Link href={`/job-orders/${j.id}`} className="font-medium text-brand-700 hover:underline">{j.title}</Link>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status]}`}>{tj(`status.${j.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardClass} space-y-3 p-5`} data-testid="section-site-status">
          <h2 className="font-medium">{t("statusTitle")}</h2>
          <ActiveToggle kind="site" hidden={{ siteId: site.id, companyId: company.id }} active={site.active} />
          {me.role === "TSK_ADMIN" && <DeleteButton kind="site" hidden={{ siteId: site.id, companyId: company.id }} warning={t("deleteSiteWarning")} />}
        </section>
      </div>
    </>
  );
}
