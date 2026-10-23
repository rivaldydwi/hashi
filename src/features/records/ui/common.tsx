import { getLocale, getTranslations } from "next-intl/server";
import { longDate } from "@/lib/org-time";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-ink",
  accent: "bg-accent-soft text-accent-text",
  ok: "bg-ok-bg text-ok-text",
  warn: "bg-warn-bg text-warn-text",
  danger: "bg-danger-bg text-danger-text",
  info: "bg-info-bg text-info-text",
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

/**
 * Teks ber-baris-baru (isi catatan) tampil apa adanya, aman: React meng-escape. Teks bebas BOLEH diterjemahkan peramban (T-023) dan tanpa `lang`
 * (peramban menebak sendiri); `identity` dipakai hanya untuk isian yang berisi nama orang/organisasi (mis. "lapor ke") supaya dikunci `translate="no"`.
 */
export function Multiline({ text, identity = false }: { text: string | null | undefined; identity?: boolean }) {
  if (!text) return <span className="text-ink-2">—</span>;
  return <p translate={identity ? "no" : undefined} className="whitespace-pre-wrap break-words text-sm text-ink">{text}</p>;
}
