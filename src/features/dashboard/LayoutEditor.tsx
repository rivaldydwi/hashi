"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { defaultLayout, toStored, type ResolvedItem } from "@/db/dashboard-layout";
import type { Role } from "@/db/schema";
import { btnSecondary } from "@/components/styles";
import { useToast } from "@/components/Toast";
import { saveDashboardLayout, resetDashboardLayout } from "./actions";

type Status = "idle" | "saving" | "saved" | "failed";

const ctl = "inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-line-btn bg-card px-3 text-[13px] font-medium text-ink-menu hover:bg-hover disabled:opacity-40 disabled:hover:bg-card";

/**
 * Mode atur dashboard. Isi widget dirender server (`slots`); komponen ini hanya mengatur urutan, ukuran, dan sembunyi, lalu menyimpan
 * otomatis (debounce) lewat server action. Tombol biasa (bukan seret-lepas), jadi bisa dipakai dengan keyboard dan layar sentuh.
 */
export function LayoutEditor({ role, initial, slots, labels }: { role: Role; initial: ResolvedItem[]; slots: Record<string, ReactNode>; labels: Record<string, string> }) {
  const t = useTranslations("dashboard.edit");
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: ResolvedItem[]) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    timer.current = setTimeout(async () => {
      try {
        const res = await saveDashboardLayout(toStored(next));
        setStatus(res.ok ? "saved" : "failed");
        if (!res.ok) toast(t("failed"), "error");
      } catch {
        setStatus("failed");
        toast(t("failed"), "error");
      }
    }, 350);
  }, [t, toast]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const change = (next: ResolvedItem[]) => { setItems(next); persist(next); };
  const move = (id: string, dir: -1 | 1) => {
    const i = items.findIndex((x) => x.id === id);
    // tukar dengan tetangga TERDEKAT yang terlihat dan sejenis (KPI dengan KPI, widget dengan widget)
    let j = i + dir;
    while (j >= 0 && j < items.length && (items[j].kind !== items[i].kind || items[j].hidden)) j += dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const patch = (id: string, p: Partial<ResolvedItem>) => change(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const reset = async () => {
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    try {
      await resetDashboardLayout();
      setItems(defaultLayout(role));
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("failed");
    }
  };

  const visible = items.filter((x) => !x.hidden);
  const hidden = items.filter((x) => x.hidden);
  const canMove = (x: ResolvedItem, dir: -1 | 1) => {
    const i = items.findIndex((y) => y.id === x.id);
    for (let j = i + dir; j >= 0 && j < items.length; j += dir) if (items[j].kind === x.kind && !items[j].hidden) return true;
    return false;
  };

  const controls = (x: ResolvedItem) => (
    <div className="flex flex-wrap items-center gap-2 rounded-t-2xl border border-b-0 border-dashed border-accent bg-accent-soft px-3 py-2" data-testid={`edit-bar-${x.id}`}>
      <span className="w-full text-[13px] font-semibold text-accent-text">{labels[x.id]}</span>
      {x.kind === "widget" && (
        <div role="group" aria-label={t("sizeOf", { name: labels[x.id] })} className="flex gap-1">
          {(["half", "full"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={x.size === s} data-testid={`size-${s}-${x.id}`} onClick={() => patch(x.id, { size: s })} className={`${ctl} ${x.size === s ? "!border-accent !bg-accent !text-white" : ""}`}>
              {t(s === "full" ? "sizeFull" : "sizeHalf")}
            </button>
          ))}
        </div>
      )}
      <button type="button" disabled={!canMove(x, -1)} onClick={() => move(x.id, -1)} aria-label={t("moveUp", { name: labels[x.id] })} data-testid={`up-${x.id}`} className={ctl}>↑</button>
      <button type="button" disabled={!canMove(x, 1)} onClick={() => move(x.id, 1)} aria-label={t("moveDown", { name: labels[x.id] })} data-testid={`down-${x.id}`} className={ctl}>↓</button>
      <button type="button" onClick={() => patch(x.id, { hidden: true })} aria-label={t("hideNamed", { name: labels[x.id] })} data-testid={`hide-${x.id}`} className={ctl}>{t("hide")}</button>
    </div>
  );

  const kpis = visible.filter((x) => x.kind === "kpi");
  const widgets = visible.filter((x) => x.kind === "widget");

  return (
    <div className="space-y-6" data-testid="layout-editor">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-4">
        <p className="min-w-0 flex-1 basis-60 text-sm text-ink-2">{t("hint")}</p>
        <span role="status" aria-live="polite" className="text-sm text-ink-2" data-testid="layout-status">
          {status === "saving" ? t("saving") : status === "saved" ? t("saved") : status === "failed" ? t("failed") : ""}
        </span>
        <button type="button" onClick={reset} className={btnSecondary} data-testid="layout-reset">{t("reset")}</button>
      </div>

      {kpis.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpi-row">
          {kpis.map((x) => (
            <div key={x.id} className="flex flex-col">
              {controls(x)}
              <div className="pointer-events-none [&>*]:rounded-t-none" inert>{slots[x.id]}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="widget-grid">
        {widgets.map((x) => (
          <div key={x.id} className={`flex flex-col ${x.size === "full" ? "lg:col-span-2" : ""}`} data-testid={`slot-${x.id}`} data-size={x.size}>
            {controls(x)}
            <div className="pointer-events-none [&>*]:rounded-t-none" inert>{slots[x.id]}</div>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-card p-5" data-testid="hidden-widgets">
        <h2 className="text-[17px] font-semibold">{t("hiddenTitle")}</h2>
        {hidden.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">{t("hiddenEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {hidden.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-1">
                <span className="text-sm text-ink-menu">{labels[x.id]}</span>
                <button type="button" onClick={() => patch(x.id, { hidden: false })} aria-label={t("showNamed", { name: labels[x.id] })} data-testid={`show-${x.id}`} className={ctl}>{t("show")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
