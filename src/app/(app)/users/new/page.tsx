import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { getOrganization } from "@/features/users/queries";
import { UserCreateForm } from "@/features/users/UserCreateForm";
import { userAdminScope } from "@/features/users/scope";
import { ROLES_BY_ORG_TYPE } from "@/lib/permissions";

export default async function NewUserPage() {
  const scope = await userAdminScope();
  const t = await getTranslations("users");
  const org = await scope.run((tx) => getOrganization(tx, scope.orgId));

  return (
    <>
      <PageHeader title={t("newTitle")} intro={t("newIntro")} backHref="/users" backLabel={t("title")} />
      <UserCreateForm roles={ROLES_BY_ORG_TYPE[org.type]} defaultLocale={org.defaultLocale} backHref="/users" />
    </>
  );
}
