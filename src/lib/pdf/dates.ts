// Format tanggal Jepang untuk PDF dan pratinjau (tanpa pdfkit, aman diimpor halaman server).
/** "2026/10/05 14:20" di zona waktu tertentu (tanggal pembuatan PDF, tanggal-waktu di tabel). */
export function jaDateTime(d: Date | string, tz: string, withTime = true): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(dt);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return withTime ? `${g("year")}/${g("month")}/${g("day")} ${g("hour")}:${g("minute")}` : `${g("year")}/${g("month")}/${g("day")}`;
}

/** "2026-10-05" -> "2026年10月5日" (judul laporan harian). */
export const jaDay = (ymd: string) => `${Number(ymd.slice(0, 4))}年${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
