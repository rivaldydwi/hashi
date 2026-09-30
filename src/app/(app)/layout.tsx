import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { logout } from "@/lib/actions";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = await getTranslations();

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
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
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-stone-400">{t("common.version")}</footer>
    </div>
  );
}
