"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "./Icon";

type Ctx = { open: boolean; setOpen: (v: boolean) => void; menuButton: React.RefObject<HTMLButtonElement | null> };
const ShellCtx = createContext<Ctx | null>(null);
const useShell = () => useContext(ShellCtx)!;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * Kerangka aplikasi: sidebar tetap di layar lebar (>= 900 px) dan laci dari kiri di layar sempit (lapisan gelap, tombol tutup,
 * fokus terkunci di dalam laci, Esc menutup, fokus kembali ke tombol menu). Isi sidebar dan bilah atas dikirim sebagai props.
 */
export function ShellFrame({ sidebar, topbar, children }: { sidebar: React.ReactNode; topbar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const t = useTranslations("shell");

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => menuButton.current?.focus()); // fokus kembali ke tombol menu (setelah area utama tidak inert lagi)
  }, []);

  // Tutup laci saat pindah halaman
  useEffect(() => setOpen(false), [pathname]);

  // Laci terbuka: fokus ke dalam, Esc menutup, Tab berputar di dalam laci
  useEffect(() => {
    if (!open) return;
    const el = drawer.current;
    if (!el) return;
    const items = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        const list = items();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <ShellCtx.Provider value={{ open, setOpen, menuButton }}>
      <div className="min-h-screen min-[900px]:flex">
        <aside
          ref={drawer}
          id="app-sidebar"
          aria-label={t("sidebar")}
          data-open={open}
          data-testid="sidebar"
          className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col overflow-y-auto border-r border-line bg-card transition-transform duration-200 min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-screen min-[900px]:translate-x-0 ${open ? "translate-x-0 max-[899px]:visible" : "-translate-x-full max-[899px]:invisible max-[899px]:[transition:transform_200ms,visibility_0s_linear_200ms]"}`}
        >
          <button type="button" onClick={close} aria-label={t("closeMenu")} data-testid="drawer-close" className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-menu hover:bg-hover min-[900px]:hidden">
            <Icon name="close" />
          </button>
          {sidebar}
        </aside>
        {open && <div aria-hidden="true" data-testid="drawer-backdrop" onClick={close} className="fixed inset-0 z-30 bg-black/45 min-[900px]:hidden" />}
        <div className="min-w-0 flex-1" {...(open ? { inert: true } : {})}>
          {topbar}
          <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </div>
      </div>
    </ShellCtx.Provider>
  );
}

/** Tombol menu di bilah atas (hanya di layar sempit). */
export function MenuButton() {
  const { open, setOpen, menuButton } = useShell();
  const t = useTranslations("shell");
  return (
    <button
      ref={menuButton}
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-controls="app-sidebar"
      aria-label={t("openMenu")}
      data-testid="menu-button"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line-btn bg-card text-ink-menu hover:bg-hover min-[900px]:hidden"
    >
      <Icon name="menu" />
    </button>
  );
}
