import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary } from "@/components/styles";
import { listUsers } from "@/features/users/queries";
import { UserTable } from "@/features/users/UserTable";
import { userAdminScope } from "@/features/users/scope";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const scope = await userAdminScope();
  const t = await getTranslations("users");
  const rows = await scope.run((tx) => listUsers(tx, scope.orgId));

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro", { org: scope.me.organizationName })}
        action={
          <Link href="/users/new" className={btnPrimary}>
            + {t("add")}
          </Link>
        }
      />
      <UserTable rows={rows} basePath="/users" currentUserId={scope.me.id} />
    </>
  );
}
