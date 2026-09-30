import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { withSystem } from "@/db";
import { PartnershipForm } from "@/features/organizations/PartnershipForm";
import { PartnershipTable } from "@/features/organizations/PartnershipTable";
import { listOrganizationsByType, listPartnerships } from "@/features/organizations/queries";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Partnerships" };

export default async function PartnershipsPage() {
  await requireRole("SUPER_ADMIN");
  const t = await getTranslations("partnerships");

  const data = await withSystem(async (tx) => ({
    rows: await listPartnerships(tx),
    lpks: await listOrganizationsByType(tx, "LPK"),
    tsks: await listOrganizationsByType(tx, "TSK"),
  }));

  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PartnershipTable rows={data.rows} editable />
        </div>
        <PartnershipForm lpks={data.lpks} tsks={data.tsks} />
      </div>
    </>
  );
}
