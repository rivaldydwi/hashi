"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { inputClass } from "@/components/styles";

export type PickWorker = { id: string; name: string; katakana: string | null; site: string; /** tanggal berhenti bekerja (YYYY-MM-DD) bila penempatannya sudah berakhir; ditampilkan sebagai penanda */ endedOn?: string | null };

/** Pilih banyak pekerja aktif (cari nama atau katakana). Mengirim `name` (bawaan "subjects") berulang. */
export function WorkerPicker({ workers, selected, name = "subjects", id = "workers" }: { workers: PickWorker[]; selected: string[]; name?: string; id?: string }) {
  const t = useTranslations("records");
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string[]>(selected);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return workers.filter((w) => !n || w.name.toLowerCase().includes(n) || (w.katakana ?? "").toLowerCase().includes(n) || chosen.includes(w.id) && n === "");
  }, [q, workers, chosen]);
  return (
    <div className="space-y-2" data-testid={`picker-${id}`}>
      <label htmlFor={`${id}-q`} className="sr-only">{t("pickers.searchWorker")}</label>
      <input id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pickers.searchWorker")} className={inputClass} />
      <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-xl border border-line-btn bg-card">
        {shown.length === 0 && <li className="px-3 py-3 text-sm text-ink-2">{t("pickers.noWorker")}</li>}
        {shown.map((w) => (
          <li key={w.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-hover">
              <input type="checkbox" name={name} value={w.id} checked={chosen.includes(w.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, w.id] : c.filter((x) => x !== w.id)))} className="h-5 w-5 rounded border-line-btn" data-testid={`worker-${w.id}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{w.name}{w.endedOn && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-800" data-testid={`worker-ended-${w.id}`}>{t("pickers.endedOn", { date: w.endedOn.replace(/-/g, "/") })}</span>}</span>
                <span className="block truncate text-xs text-ink-2">{w.katakana ? `${w.katakana} · ` : ""}{w.site}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-2" aria-live="polite">{t("pickers.chosenCount", { n: chosen.length })}</p>
    </div>
  );
}

export type PickStaff = { id: string; name: string; role: string };

/** Pilih banyak staf TSK (penerima, hadirin). */
export function StaffPicker({ staff, selected, name, legend, roleLabels }: { staff: PickStaff[]; selected: string[]; name: string; legend: string; roleLabels: Record<string, string> }) {
  const [chosen, setChosen] = useState<string[]>(selected);
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-[13px] font-medium text-ink-menu">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {staff.map((s) => (
          <label key={s.id} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${chosen.includes(s.id) ? "border-accent bg-accent-soft text-accent-text" : "border-line-btn bg-card text-ink-menu"}`}>
            <input type="checkbox" name={name} value={s.id} checked={chosen.includes(s.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id)))} className="h-4 w-4" data-testid={`${name}-${s.id}`} />
            {s.name} <span className="text-xs text-ink-2">({roleLabels[s.role] ?? s.role})</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
