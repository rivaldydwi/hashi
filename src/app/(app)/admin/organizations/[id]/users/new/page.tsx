import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { getOrganization } from "@/features/users/queries";
import { isUuid, userAdminScope } from "@/features/users/scope";
import { UserCreateForm } from "@/features/users/UserCreateForm";
import { ROLES_BY_ORG_TYPE } from "@/lib/permissions";
import { requireRole } from "@/lib/session";

export default async function AdminNewUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireRole("SUPER_ADMIN");
  const scope = await userAdminScope(id);
  const t = await getTranslations("users");
  const org = await scope.run((tx) => getOrganization(tx, id));
  if (!org) notFound();
  const base = `/admin/organizations/${id}`;

  return (
    <>
      <PageHeader title={t("newTitle")} intro={`${org.name} · ${t("newIntro")}`} backHref={base} backLabel={org.name} />
      <UserCreateForm roles={ROLES_BY_ORG_TYPE[org.type]} orgId={id} backHref={base} />
    </>
  );
}
