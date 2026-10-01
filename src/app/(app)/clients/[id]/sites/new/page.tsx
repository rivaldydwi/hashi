import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { cardClass } from "@/components/styles";
import { SiteForm } from "@/features/clients/ClientForms";
import { requireTsk, uuid } from "@/features/clients/guards";
import { getCompany } from "@/features/clients/queries";
import { tenantQuery } from "@/lib/session";

export default async function NewSitePage({ params }: { params: Promise<{ id: string }> }) {
  await requireTsk();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const data = await tenantQuery((tx) => getCompany(tx, id));
  if (!data) notFound();
  const t = await getTranslations("clients");
  return (
    <>
      <PageHeader title={t("newSiteTitle")} intro={data.company.name} backHref={`/clients/${id}`} backLabel={data.company.name} />
      <div className={`${cardClass} max-w-3xl p-5`}>
        <SiteForm companyId={id} />
      </div>
    </>
  );
}
