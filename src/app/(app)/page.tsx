import { asc, count, desc, eq, ne } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { withSystem, withTenant } from "@/db";
import { platformOverview } from "@/db/queries";
import { candidates, candidateStage, organizations, type Role } from "@/db/schema";
import { StageBadge } from "@/components/StageBadge";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("greeting", { name: user.name ?? "" })}</h1>
      {user.role === "SUPER_ADMIN" ? (
        <PlatformOverview />
      ) : (
        <TenantDashboard orgId={user.organizationId} role={user.role} isTsk={user.organizationType === "TSK"} />
      )}
    </div>
  );
}

async function TenantDashboard({ orgId, role, isTsk }: { orgId: string; role: Role; isTsk: boolean }) {
  const t = await getTranslations("dashboard");
  const tType = await getTranslations("orgTypes");

  // Semua query lewat withTenant: RLS yang menentukan data mana yang terlihat.
  const { byStage, partners, recent } = await withTenant(orgId, role, async (tx) => ({
    byStage: await tx
      .select({ stage: candidates.stage, total: count() })
      .from(candidates)
      .groupBy(candidates.stage),
    partners: await tx
      .select({ id: organizations.id, name: organizations.name, type: organizations.type })
      .from(organizations)
      .where(ne(organizations.id, orgId))
      .orderBy(asc(organizations.name)),
    recent: await tx
      .select({
        id: candidates.id,
        fullName: candidates.fullName,
        nameKatakana: candidates.nameKatakana,
        field: candidates.field,
        stage: candidates.stage,
        lpkName: organizations.name,
      })
      .from(candidates)
      .innerJoin(organizations, eq(organizations.id, candidates.organizationId))
      .orderBy(desc(candidates.createdAt), asc(candidates.fullName))
      .limit(10),
  }));

  const counts = new Map(byStage.map((r) => [r.stage, r.total]));
  const total = byStage.reduce((sum, r) => sum + r.total, 0);

  return (
    <>
      {isTsk && <p className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900">{t("tskNote")}</p>}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-500">{t("visibleCandidates")}</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums" data-testid="visible-count">
            {total}
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 md:col-span-2">
          <p className="text-sm text-stone-500">{t("byStage")}</p>
          <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {candidateStage.enumValues.map((stage) => {
              const n = counts.get(stage) ?? 0;
              return (
                <li key={stage} className={`flex items-center justify-between ${n === 0 ? "opacity-40" : ""}`}>
                  <StageBadge stage={stage} />
                  <span className="text-sm font-medium tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="font-medium">{t("partners")}</h2>
        {partners.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">{t("noPartners")}</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {partners.map((p) => (
              <li key={p.id} className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm">
                {p.name} <span className="text-stone-400">· {tType(p.type)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <h2 className="px-5 pt-5 font-medium">{t("recent")}</h2>
        {recent.length === 0 ? (
          <p className="px-5 pb-5 pt-2 text-sm text-stone-500">{t("empty")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-5 py-2 font-medium">{t("colName")}</th>
                  <th className="px-5 py-2 font-medium">{t("colLpk")}</th>
                  <th className="px-5 py-2 font-medium">{t("colField")}</th>
                  <th className="px-5 py-2 font-medium">{t("colStage")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{c.fullName}</div>
                      {c.nameKatakana && <div className="text-xs text-stone-500">{c.nameKatakana}</div>}
                    </td>
                    <td className="px-5 py-3 text-stone-700">{c.lpkName}</td>
                    <td className="px-5 py-3 text-stone-700">{c.field ?? "—"}</td>
                    <td className="px-5 py-3">
                      <StageBadge stage={c.stage} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-sm text-stone-500">{t("nextModules")}</p>
    </>
  );
}

// Super admin hanya melihat angka ringkasan, bukan data pribadi kandidat.
async function PlatformOverview() {
  const t = await getTranslations("dashboard");
  const tType = await getTranslations("orgTypes");

  const rows = await withSystem((tx) => platformOverview(tx));

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <h2 className="px-5 pt-5 font-medium">{t("platformTitle")}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-y border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-5 py-2 font-medium">{t("colOrg")}</th>
              <th className="px-5 py-2 font-medium">{t("colType")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("colUsers")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("colCandidates")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-3 font-medium">{r.name}</td>
                <td className="px-5 py-3 text-stone-700">{tType(r.type)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.users}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.candidates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
