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

// ---- Kelompok KPI (T-035): kartu dikelompokkan menurut alur kerja, bukan satu grid rata. Kelompok + KPI utama ditetapkan di katalog.

/** Kelompok alur kerja; urutan array = urutan tampil di beranda (judul: `dashboard.groups.<kelompok>`). */
export const KPI_GROUPS = ["students", "documents", "selection", "workers", "records", "system"] as const;
export type KpiGroup = (typeof KPI_GROUPS)[number];
/** Batas KPI utama (tampil lebih besar) per peran: lebih dari ini = tidak ada lagi yang menonjol. */
export const MAX_PRIMARY_PER_ROLE = 3;

/**
 * Kelompokkan KPI yang tampil. Urutan DI DALAM kelompok = urutan layout pengguna (mode atur), urutan kelompok = `KPI_GROUPS`;
 * kelompok kosong dibuang. `groupOf` diberikan pemanggil supaya fungsi ini murni dan tidak bergantung katalog.
 */
export function groupKpis<T extends { id: string }>(items: readonly T[], groupOf: (id: string) => KpiGroup): Array<{ group: KpiGroup; items: T[] }> {
  return KPI_GROUPS.map((group) => ({ group, items: items.filter((x) => groupOf(x.id) === group) })).filter((g) => g.items.length > 0);
}
