import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Sidebar, type SidebarItem, type SoonItem } from "@/components/shell/Sidebar";
import { buildCommit } from "@/lib/build-info";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { Topbar } from "@/components/shell/Topbar";
import { viewCandidateIds } from "@/db/dashboard-queries";
import { unreadRecordIds, unreadReportIds } from "@/db/records-queries";
import { ToastProvider } from "@/components/Toast";
import { SkillFieldsProvider } from "@/features/skill-fields/SkillFieldsProvider";
import { getSkillFieldOptions } from "@/features/skill-fields/server";
import { longDate, safeTimezone } from "@/lib/org-time";
import { requireUser, tenantQuery } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Login dengan kata sandi sementara: wajib ganti dulu sebelum bisa memakai aplikasi.
  if (user.mustChangePassword) redirect("/change-password");

  const t = await getTranslations();
  const locale = await getLocale();
  const skillOptions = await getSkillFieldOptions();
  const isLpk = user.role === "LPK_ADMIN" || user.role === "LPK_SENSEI";
  const isTsk = user.role === "TSK_ADMIN" || user.role === "TSK_STAFF";

  // Lencana angka di menu: angka yang SAMA dengan daftar yang dibuka lewat menu (fungsi filter yang sama dengan dashboard)
  const badge = isLpk
    ? (await tenantQuery((tx) => viewCandidateIds(tx, "unrated"))).length
    : isTsk
      ? (await tenantQuery((tx) => viewCandidateIds(tx, "new-shared"))).length
      : 0;

  // Catatan kegiatan (khusus TSK): lencana = catatan belum kubaca + laporan harian staf belum kubaca (angka yang sama dengan KPI dashboard)
  const recordsBadge = isTsk ? await tenantQuery(async (tx) => (await unreadRecordIds(tx, user.id)).length + (await unreadReportIds(tx, user.id)).length) : 0;

  const items: SidebarItem[] = [{ href: "/", label: t("nav.dashboard"), icon: "dashboard" }];
  if (user.role === "SUPER_ADMIN") {
    items.push({ href: "/admin/organizations", label: t("nav.organizations"), icon: "organizations" });
    items.push({ href: "/admin/skill-fields", label: t("nav.skillFields"), icon: "skillFields" });
    items.push({ href: "/admin/partnerships", label: t("nav.partnerships"), icon: "partnerships" });
  } else {
    items.push({ href: "/candidates", label: t("nav.candidates"), icon: "candidates", ...(isTsk ? { badge, badgeLabel: t("shell.badgeNewShared", { n: badge }) } : {}) });
    if (isLpk) items.push({ href: "/assessments/pending", label: t("nav.assessments"), icon: "assessments", badge, badgeLabel: t("shell.badgeUnrated", { n: badge }) });
    if (isTsk) {
      items.push({ href: "/clients", label: t("nav.clients"), icon: "clients" });
      items.push({ href: "/job-orders", label: t("nav.jobOrders"), icon: "jobOrders" });
      items.push({ href: "/records", label: t("nav.records"), icon: "records", badge: recordsBadge, badgeLabel: t("shell.badgeRecords", { n: recordsBadge }) });
      items.push({ href: "/records/cards", label: t("nav.residenceCard"), icon: "residence" });
    }
    if (user.role === "LPK_ADMIN" || user.role === "TSK_ADMIN") {
      items.push({ href: "/users", label: t("nav.users"), icon: "users" });
      items.push({ href: "/activity", label: t("nav.activity"), icon: "history" });
    }
  }
  const soon: SoonItem[] = []; // belum ada menu "segera hadir" (在留カード sudah menjadi menu sungguhan, T-019)

  const action =
    user.role === "LPK_ADMIN"
      ? { href: "/candidates/new", label: t("shell.addCandidate") }
      : isTsk
        ? { href: "/job-orders/new", label: t("shell.createJobOrder") }
        : null;
  // Judul halaman di bilah atas: dari menu, ditambah halaman yang tidak ada di menu
  const titles = [...items.map((i) => ({ href: i.href, label: i.label })), { href: "/account", label: t("nav.account") }, { href: "/admin/organizations", label: t("nav.organizations") }];

  return (
    <SkillFieldsProvider options={skillOptions}>
      <ToastProvider>
      <ShellFrame
        sidebar={<Sidebar items={items} soon={soon} org={{ name: user.organizationName, roleLabel: t(`roles.${user.role}`) }} user={{ name: user.name, email: user.email }} commit={buildCommit()} />}
        topbar={
          <Suspense fallback={<div className="h-[61px] border-b border-line bg-card" />}>
            <Topbar titles={titles} dateLabel={longDate(new Date(), locale, safeTimezone(user.organizationTimezone, user.organizationType))} showSearch={user.role !== "SUPER_ADMIN"} action={action} customizable={true} />
          </Suspense>
        }
      >
        {children}
      </ShellFrame>
      </ToastProvider>
    </SkillFieldsProvider>
  );
}
