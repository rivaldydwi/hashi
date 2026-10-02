import { getTranslations } from "next-intl/server";
import { loadDashboard } from "@/features/dashboard/data";
import { widgetsForRole } from "@/features/dashboard/catalog";
import { Widget } from "@/features/dashboard/Widgets";
import { Onboarding } from "@/features/dashboard/Onboarding";
import { withTenant } from "@/db";
import { candidateTotal } from "@/db/dashboard-queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const t = await getTranslations("dashboard");

  // LPK_ADMIN tanpa kandidat: tampilkan panduan 3 langkah, bukan dashboard berisi angka nol.
  if (user.role === "LPK_ADMIN") {
    const total = await withTenant({ orgId: user.organizationId, role: user.role, userId: user.id }, (tx) => candidateTotal(tx));
    if (total === 0) return <Onboarding name={user.name ?? ""} />;
  }

  const defs = widgetsForRole(user.role);
  const data = await loadDashboard(user, new Set(defs.map((d) => d.id)));
  const kpis = defs.filter((d) => d.kind === "kpi");
  const widgets = defs.filter((d) => d.kind === "widget");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("greeting", { name: user.name ?? "" })}</h1>
      {kpis.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpi-row">
          {kpis.map((k) => <Widget key={k.id} id={k.id} data={data} />)}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="widget-grid">
        {widgets.map((w) => (
          <div key={w.id} className={w.defaultSize === "full" ? "lg:col-span-2" : ""}>
            <Widget id={w.id} data={data} />
          </div>
        ))}
      </div>
    </div>
  );
}
