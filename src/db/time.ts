// Zona waktu aplikasi. SATU konstanta yang mudah diganti: dipakai untuk "bulan berjalan" (penilaian bulanan,
// daftar "belum dinilai bulan ini") dan seed. Modul ini murni (tanpa impor) supaya aman dipakai script di image tools.
export const APP_TIMEZONE = "Asia/Jakarta";

/** Tanggal kalender (YYYY-MM-DD) saat ini di zona waktu aplikasi. */
export function todayInAppTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Tanggal awal bulan (YYYY-MM-01) dari sebuah tanggal YYYY-MM-DD. Sama dengan `period` yang diisi trigger database. */
export function periodOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** Awal bulan berjalan di zona waktu aplikasi. */
export function currentPeriod(now: Date = new Date()): string {
  return periodOf(todayInAppTz(now));
}

/** Awal bulan, `n` bulan sebelum awal bulan berjalan. */
export function periodMonthsAgo(n: number, now: Date = new Date()): string {
  const [y, m] = currentPeriod(now).split("-").map(Number);
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}
