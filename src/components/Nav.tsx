"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Main">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${
              active
                ? "border-brand-600 font-medium text-stone-900"
                : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
