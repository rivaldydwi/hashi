"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TabDef = { href: string; label: string; badge?: number };

/** Tab navigasi Catatan kegiatan (rute per tab). Aktif = awalan terpanjang yang cocok. */
export function RecordsTabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  const path = usePathname();
  const active = [...tabs].filter((t) => (t.href === "/records" ? path === "/records" || /^\/records\/(new|reports|[0-9a-f-]{36})/.test(path) : path === t.href || path.startsWith(t.href + "/"))).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={label} className="-mx-4 mb-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" data-testid="records-tabs">
      <ul className="flex gap-1 whitespace-nowrap">
        {tabs.map((t) => {
          const on = t.href === active;
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={on ? "page" : undefined} data-testid="records-tab" className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-[14px] font-semibold ${on ? "border-accent text-accent-text" : "border-transparent text-ink-menu hover:bg-hover"}`}>
                {t.label}
                {t.badge ? <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">{t.badge}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
