import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Nav, type NavItem } from "@/components/Nav";
import { logout } from "@/lib/actions";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Login dengan kata sandi sementara: wajib ganti dulu sebelum bisa memakai aplikasi.
  if (user.mustChangePassword) redirect("/change-password");

  const t = await getTranslations();

  const nav: NavItem[] = [{ href: "/", label: t("nav.dashboard") }];
  if (user.role !== "SUPER_ADMIN") nav.push({ href: "/candidates", label: t("nav.candidates") });
  if (user.role === "LPK_ADMIN" || user.role === "LPK_SENSEI") nav.push({ href: "/assessments/pending", label: t("nav.assessments") });
  if (user.role === "LPK_ADMIN" || user.role === "TSK_ADMIN") {
    nav.push({ href: "/users", label: t("nav.users") });
  }
  if (user.role === "SUPER_ADMIN") {
    nav.push({ href: "/admin/organizations", label: t("nav.organizations") });
    nav.push({ href: "/admin/partnerships", label: t("nav.partnerships") });
  }
  nav.push({ href: "/account", label: t("nav.account") });

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span className="text-lg font-semibold tracking-tight">{t("common.appName")}</span>
            <span className="hidden text-stone-300 sm:inline">/</span>
            <span className="hidden text-sm text-stone-700 sm:inline">{user.organizationName}</span>
            <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
              {t(`orgTypes.${user.organizationType}`)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <div className="hidden text-right text-sm leading-tight md:block">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs text-stone-500">{t(`roles.${user.role}`)}</div>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100"
              >
                {t("common.logout")}
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pt-2">
          <Nav items={nav} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-stone-400">{t("common.version")}</footer>
    </div>
  );
}
