import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary } from "@/components/styles";
import { withSystem } from "@/db";
import { OrgEditForm } from "@/features/organizations/OrgEditForm";
import { PartnershipTable } from "@/features/organizations/PartnershipTable";
import { listPartnerships } from "@/features/organizations/queries";
import { getOrganization, listUsers } from "@/features/users/queries";
import { isUuid } from "@/features/users/scope";
import { UserTable } from "@/features/users/UserTable";
import { requireRole } from "@/lib/session";

export default async function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const me = await requireRole("SUPER_ADMIN");
  const t = await getTranslations("orgs");

  const data = await withSystem(async (tx) => ({
    org: await getOrganization(tx, id),
    users: await listUsers(tx, id),
    partners: await listPartnerships(tx, id),
  }));
  if (!data.org) notFound();
  const base = `/admin/organizations/${id}`;

  return (
    <>
      <PageHeader title={data.org.name} backHref="/admin/organizations" backLabel={t("title")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <OrgEditForm org={data.org} />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{t("usersTitle")}</h2>
              <Link href={`${base}/users/new`} className={`${btnPrimary} !py-1.5`}>
                + {t("addUser")}
              </Link>
            </div>
            <UserTable rows={data.users} basePath={base} currentUserId={me.id} />
          </section>
          {data.org.type !== "PLATFORM" && (
            <section className="space-y-3">
              <h2 className="font-medium">{t("partnersTitle")}</h2>
              <PartnershipTable rows={data.partners} editable={false} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
