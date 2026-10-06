// Batas beban kerja penanggung jawab (T-010): SATU konstanta konfigurasi. Dikonfirmasi staf TSK (2026-10-06): mulai April 2027 satu staf TSK maksimal mendukung 50 pekerja,
// dihitung PER ORANG staf (total semua pekerja yang dipegangnya di seluruh Jepang dan semua klien; bukan per klien, bukan per daerah). Ini peringatan, BUKAN pemblokiran (keputusan hukum).
export const WORKLOAD = {
  /** Batas maksimal pekerja per staf. Melebihi (> 50) = merah. */
  max: 50,
  /** Mulai peringatan kuning ("mendekati batas"). */
  warnAt: 45,
  /** Tanggal aturan berlaku (YYYY-MM-DD). */
  effectiveFrom: "2027-04-01",
} as const;
