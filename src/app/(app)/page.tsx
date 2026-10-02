import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageSkeleton } from "@/components/PageSkeleton";
import type { CurrentUser } from "@/lib/session";
import { loadDashboard } from "@/features/dashboard/data";
import { loadLayout } from "@/features/dashboard/queries";
import { widgetById } from "@/features/dashboard/catalog";
import { Widget } from "@/features/dashboard/Widgets";
import { LayoutEditor } from "@/features/dashboard/LayoutEditor";
import { Onboarding } from "@/features/dashboard/Onboarding";
import { withTenant } from "@/db";
import { candidateTotal } from "@/db/dashboard-queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  // Isi dashboard dimuat di dalam Suspense: kerangka muatan tampil selagi data dihitung. requireUser (redirect) ada di luar, jadi status HTTP tetap benar.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardBody user={user} editing={sp.atur === "1"} />
    </Suspense>
  );
}

async function DashboardBody({ user, editing }: { user: CurrentUser; editing: boolean }) {
  const t = await getTranslations("dashboard");

  // LPK_ADMIN tanpa kandidat: tampilkan panduan 3 langkah, bukan dashboard berisi angka nol.
  if (user.role === "LPK_ADMIN") {
    const total = await withTenant({ orgId: user.organizationId, role: user.role, userId: user.id }, (tx) => candidateTotal(tx));
    if (total === 0) return <Onboarding name={user.name ?? ""} />;
  }

  const layout = await loadLayout(user);
  // Hanya widget yang tampil yang di-query; di mode atur semuanya dimuat supaya pratinjau dan "Tampilkan" langsung bisa.
  const shown = layout.filter((x) => editing || !x.hidden);
  const data = await loadDashboard(user, new Set(shown.map((x) => x.id)));

  if (editing) {
    const labels = Object.fromEntries(layout.map((x) => [x.id, t(widgetById(x.id)!.label)]));
    const slots = Object.fromEntries(await Promise.all(layout.map(async (x) => [x.id, await Widget({ id: x.id, data })] as const)));
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t("edit.title")}</h1>
        <LayoutEditor role={user.role} initial={layout} slots={slots} labels={labels} />
      </div>
    );
  }

  const kpis = shown.filter((x) => x.kind === "kpi");
  const widgets = shown.filter((x) => x.kind === "widget");
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
          <div key={w.id} className={w.size === "full" ? "lg:col-span-2" : ""} data-size={w.size}>
            <Widget id={w.id} data={data} />
          </div>
        ))}
      </div>
      {kpis.length + widgets.length === 0 && <p className="rounded-2xl border border-line bg-card p-6 text-sm text-ink-2" data-testid="dashboard-empty">{t("allHidden")}</p>}
    </div>
  );
}
