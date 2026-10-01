import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { cardClass } from "@/components/styles";
import { CompanyForm } from "@/features/clients/ClientForms";
import { requireTsk } from "@/features/clients/guards";

export default async function NewCompanyPage() {
  await requireTsk();
  const t = await getTranslations("clients");
  return (
    <>
      <PageHeader title={t("newCompanyTitle")} backHref="/clients" backLabel={t("title")} />
      <div className={`${cardClass} max-w-3xl p-5`}>
        <CompanyForm />
      </div>
    </>
  );
}
