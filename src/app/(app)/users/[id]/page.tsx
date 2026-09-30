import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { getOrganization, getUser } from "@/features/users/queries";
import { UserAccessPanel } from "@/features/users/UserAccessPanel";
import { UserEditForm } from "@/features/users/UserEditForm";
import { isUuid, userAdminScope } from "@/features/users/scope";
import { ROLES_BY_ORG_TYPE } from "@/lib/permissions";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const scope = await userAdminScope();
  const t = await getTranslations("users");

  const data = await scope.run(async (tx) => ({
    org: await getOrganization(tx, scope.orgId),
    user: await getUser(tx, scope.orgId, id),
  }));
  if (!data.user) notFound();
  const isSelf = data.user.id === scope.me.id;

  return (
    <>
      <PageHeader title={t("editTitle")} intro={data.user.email} backHref="/users" backLabel={t("title")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <UserEditForm user={data.user} roles={ROLES_BY_ORG_TYPE[data.org.type]} isSelf={isSelf} />
        <UserAccessPanel userId={data.user.id} active={data.user.active} isSelf={isSelf} />
      </div>
    </>
  );
}
