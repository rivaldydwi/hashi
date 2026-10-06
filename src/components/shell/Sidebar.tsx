"use client";

import { BrandLogo } from "@/components/brand/BrandLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { logout } from "@/lib/actions";
import { Icon } from "./Icon";

export type SidebarItem = { href: string; label: string; icon: string; badge?: number; badgeLabel?: string };
export type SoonItem = { key: string; label: string; icon: string };

/** Isi sidebar: logo, kartu organisasi, menu, bagian "segera hadir" (TSK), saklar bahasa, dan chip akun. */
export function Sidebar({
  items,
  soon,
  org,
  user,
  commit,
}: {
  items: SidebarItem[];
  soon: SoonItem[];
  org: { name: string; roleLabel: string };
  user: { name: string; email: string };
  /** Sha pendek commit yang berjalan ("unknown" bila image dibangun tanpa GIT_SHA). */
  commit: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((p) => [...p][0]?.toUpperCase() ?? "").join("") || "?";
  // Menu aktif = awalan terpanjang yang cocok (supaya "/" tidak selalu aktif)
  const active = [...items].filter((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(i.href + "/"))).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="flex min-h-full flex-1 flex-col px-3 pb-3 pt-4">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <BrandLogo variant="full" tone="light" height={32} />
      </div>

      <div className="mb-4 rounded-xl border border-line bg-page px-3 py-2.5" data-testid="org-card">
        <div className="truncate text-[13px] font-semibold" title={org.name}>{org.name}</div>
        <span className="mt-1 inline-block rounded-full bg-role-bg px-2 py-0.5 text-[11px] font-semibold text-role-text">{org.roleLabel}</span>
      </div>

      <nav aria-label={t("menu")} className="flex-1">
        <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2">{t("menu")}</p>
        <ul className="space-y-0.5">
          {items.map((it) => {
            const on = it.href === active;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  data-testid="nav-item"
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition ${on ? "bg-accent-soft text-accent-text" : "text-ink-menu hover:bg-hover"}`}
                >
                  <Icon name={it.icon} />
                  <span className="flex-1">{it.label}</span>
                  {it.badge !== undefined && it.badge > 0 && (
                    <span data-testid="nav-badge" aria-label={it.badgeLabel} className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">{it.badge}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {soon.length > 0 && (
          <div className="mt-5" data-testid="nav-soon">
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2">{t("soon")}</p>
            <ul className="space-y-0.5">
              {soon.map((s) => (
                <li key={s.key}>
                  <span aria-disabled="true" className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-ink-2">
                    <Icon name={s.icon} />
                    <span className="flex-1">{s.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="mt-4 space-y-3 border-t border-line pt-3">
        <LanguageSwitcher />
        <details className="group relative" data-testid="account-menu">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-xl px-2 hover:bg-hover [&::-webkit-details-marker]:hidden" aria-label={t("accountMenu")}>
            <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-bold text-accent-text">{initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{user.name}</span>
              <span className="block truncate text-[11px] text-ink-2">{user.email}</span>
            </span>
            <Icon name="chevron" className="h-4 w-4 text-ink-2" />
          </summary>
          <div className="absolute inset-x-0 bottom-full mb-2 rounded-xl border border-line bg-card p-1.5 shadow-sm">
            <Link href="/account" className="flex min-h-11 items-center rounded-lg px-3 text-[14px] font-medium text-ink-menu hover:bg-hover">{t("myAccount")}</Link>
            <form action={logout}>
              <button type="submit" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[14px] font-medium text-ink-menu hover:bg-hover">{tc("logout")}</button>
            </form>
          </div>
        </details>
        <p className="px-2 pb-1 text-[11px] text-ink-2" data-testid="build-version">{tc("version", { commit })}</p>
      </div>
    </div>
  );
}
