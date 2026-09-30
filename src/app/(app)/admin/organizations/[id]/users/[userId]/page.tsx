import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { getOrganization, getUser } from "@/features/users/queries";
import { isUuid, userAdminScope } from "@/features/users/scope";
import { UserAccessPanel } from "@/features/users/UserAccessPanel";
import { UserEditForm } from "@/features/users/UserEditForm";
import { ROLES_BY_ORG_TYPE } from "@/lib/permissions";
import { requireRole } from "@/lib/session";

export default async function AdminEditUserPage({ params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  if (!isUuid(id) || !isUuid(userId)) notFound();
  await requireRole("SUPER_ADMIN");
  const scope = await userAdminScope(id);
  const t = await getTranslations("users");

  const data = await scope.run(async (tx) => ({
    org: await getOrganization(tx, id),
    user: await getUser(tx, id, userId),
  }));
  if (!data.org || !data.user) notFound();
  const isSelf = data.user.id === scope.me.id;
  const base = `/admin/organizations/${id}`;

  return (
    <>
      <PageHeader title={t("editTitle")} intro={`${data.org.name} · ${data.user.email}`} backHref={base} backLabel={data.org.name} />
      <div className="grid gap-6 lg:grid-cols-2">
        <UserEditForm user={data.user} roles={ROLES_BY_ORG_TYPE[data.org.type]} orgId={id} isSelf={isSelf} />
        <UserAccessPanel userId={data.user.id} active={data.user.active} orgId={id} isSelf={isSelf} />
      </div>
    </>
  );
}
