import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { OrgCreateForm } from "@/features/organizations/OrgCreateForm";
import { requireRole } from "@/lib/session";

export default async function NewOrganizationPage() {
  await requireRole("SUPER_ADMIN");
  const t = await getTranslations("orgs");
  return (
    <>
      <PageHeader title={t("newTitle")} backHref="/admin/organizations" backLabel={t("title")} />
      <OrgCreateForm />
    </>
  );
}
