"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "./Icon";
import { MenuButton } from "./ShellFrame";

export type TopbarProps = {
  /** Pasangan awalan URL -> judul (dari menu), dipakai untuk judul halaman di bilah atas. */
  titles: Array<{ href: string; label: string }>;
  dateLabel: string;
  showSearch: boolean;
  /** Tombol aksi utama peran (null = tidak ada). */
  action: { href: string; label: string } | null;
  /** Dashboard bisa diatur pengguna: tampilkan tombol "Atur dashboard". */
  customizable: boolean;
};

/** Bilah atas: tombol menu (ponsel), judul halaman + tanggal, pencarian global, "Atur dashboard", dan aksi utama peran. */
export function Topbar({ titles, dateLabel, showSearch, action, customizable }: TopbarProps) {
  const pathname = usePathname();
  const search = useSearchParams();
  const t = useTranslations("shell");
  const title = [...titles].filter((x) => (x.href === "/" ? pathname === "/" : pathname === x.href || pathname.startsWith(x.href + "/"))).sort((a, b) => b.href.length - a.href.length)[0]?.label ?? "";
  const editing = search.get("atur") === "1";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <MenuButton />
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate text-[15px] font-bold leading-tight" data-testid="topbar-title">{title}</div>
          <div className="truncate text-[12px] text-ink-2" data-testid="topbar-date">{dateLabel}</div>
        </div>
        {showSearch && (
          <form action="/candidates" method="get" role="search" className="relative order-last w-full min-[700px]:order-none min-[700px]:w-72" data-testid="global-search">
            <label htmlFor="global-q" className="sr-only">{t("searchLabel")}</label>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" />
            <input id="global-q" name="q" type="search" maxLength={100} placeholder={t("searchPlaceholder")} className="block h-11 w-full rounded-xl border border-line-btn bg-card pl-9 pr-3 text-[14px] outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          </form>
        )}
        {customizable && (
          <Link
            href={editing ? "/" : "/?atur=1"}
            data-testid="customize-toggle"
            aria-pressed={editing}
            className={`inline-flex h-11 items-center rounded-xl border px-4 text-[14px] font-semibold ${editing ? "border-accent bg-accent text-white hover:bg-accent-dark" : "border-line-btn bg-card text-ink-menu hover:bg-hover"}`}
          >
            {editing ? t("done") : t("customize")}
          </Link>
        )}
        {action && (
          <Link href={action.href} data-testid="primary-action" className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-dark">
            <Icon name="plus" className="h-4 w-4" />
            {action.label}
          </Link>
        )}
      </div>
    </header>
  );
}
