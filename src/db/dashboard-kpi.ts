// Tampilan kartu KPI dashboard (T-012): nada dasar per KPI ada di katalog (`dashboard-catalog.ts`); nada yang TAMPIL mengikuti nilainya.
// Murni (tanpa DB/React) supaya dites unit dan dipakai komponen `Kpi`.

/** Nada dasar di katalog: neutral = hitungan umum, info = informasi, attention = "perlu tindakan" (hanya menyala bila nilainya > 0). */
export type KpiTone = "neutral" | "info" | "attention";
/** Tampilan akhir: `calm` = KPI tindakan yang bernilai 0 ("beres"; ikon centang). */
export type KpiLook = KpiTone | "calm";

export function kpiLook(tone: KpiTone, value: number): KpiLook {
  if (tone === "attention") return value > 0 ? "attention" : "calm";
  return tone;
}
