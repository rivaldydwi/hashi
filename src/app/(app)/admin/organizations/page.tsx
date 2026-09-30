import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, cardClass, tableHeadClass } from "@/components/styles";
import { withSystem } from "@/db";
import { platformOverview } from "@/db/queries";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  await requireRole("SUPER_ADMIN");
  const t = await getTranslations();
  const rows = await withSystem((tx) => platformOverview(tx));

  return (
    <>
      <PageHeader
        title={t("orgs.title")}
        intro={t("orgs.intro")}
        action={
          <Link href="/admin/organizations/new" className={btnPrimary}>
            + {t("orgs.add")}
          </Link>
        }
      />
      <div className={`${cardClass} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="org-table">
            <thead className={tableHeadClass}>
              <tr>
                <th className="px-5 py-2 font-medium">{t("dashboard.colOrg")}</th>
                <th className="px-5 py-2 font-medium">{t("dashboard.colType")}</th>
                <th className="px-5 py-2 text-right font-medium">{t("dashboard.colUsers")}</th>
                <th className="px-5 py-2 text-right font-medium">{t("dashboard.colCandidates")}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 font-medium">{r.name}</td>
                  <td className="px-5 py-3 text-stone-700">{t(`orgTypes.${r.type}`)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.users}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.candidates}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/organizations/${r.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                      {t("orgs.manage")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
