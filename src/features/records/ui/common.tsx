import { getLocale, getTranslations } from "next-intl/server";
import { longDate } from "@/lib/org-time";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-800",
  accent: "bg-accent-soft text-accent-text",
  ok: "bg-emerald-50 text-emerald-900",
  warn: "bg-amber-50 text-amber-900",
  danger: "bg-rose-50 text-rose-900",
  info: "bg-sky-50 text-sky-900",
};
/** Lencana kecil: SELALU berisi teks (warna bukan satu-satunya pembeda). */
export function Badge({ tone = "neutral", children, testId }: { tone?: Tone; children: React.ReactNode; testId?: string }) {
  return <span data-testid={testId} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

/** "2026-10-05" -> tanggal panjang menurut bahasa tampilan (tanggal kalender, tanpa konversi zona waktu). */
export async function dateLabel(ymd: string): Promise<string> {
  const locale = await getLocale();
  return longDate(new Date(`${ymd}T12:00:00Z`), locale, "UTC");
}
export function dateLabelSync(ymd: string, locale: string): string {
  return longDate(new Date(`${ymd}T12:00:00Z`), locale, "UTC");
}

export async function roleLabelMap(): Promise<Record<string, string>> {
  const t = await getTranslations("roles");
  return { TSK_ADMIN: t("TSK_ADMIN"), TSK_STAFF: t("TSK_STAFF") };
}

/** Teks ber-baris-baru (isi catatan) tampil apa adanya, aman: React meng-escape. */
export function Multiline({ text, lang = "ja" }: { text: string | null | undefined; lang?: string }) {
  if (!text) return <span className="text-ink-2">—</span>;
  return <p lang={lang} className="whitespace-pre-wrap break-words text-sm text-ink">{text}</p>;
}
