import type { OrgType } from "@/db/schema";

/** Zona waktu tampilan menurut jenis organisasi (LPK/platform: Jakarta, TSK: Tokyo). Kolom organizations.timezone menggantikan ini di Tugas 4. */
export const tzForOrgType = (type: OrgType): string => (type === "TSK" ? "Asia/Tokyo" : "Asia/Jakarta");

/** Tanggal panjang menurut bahasa tampilan, mis. "Jumat, 2 Oktober 2026" / "2026年10月2日金曜日". */
export function longDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
}

/** Zona waktu yang valid (nama IANA yang dikenal Intl); selain itu kembali ke bawaan menurut jenis organisasi. */
export function safeTimezone(tz: string | null | undefined, type: OrgType): string {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    /* zona tidak dikenal */
  }
  return tzForOrgType(type);
}

/** Tanggal + jam singkat di zona organisasi, mis. "2 Okt 2026, 14.05" / "2026/10/02 14:05". */
export function dateTimeIn(date: Date | string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "id-ID", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(date));
}

/** Tanggal kalender (YYYY-MM-DD) suatu saat di zona tertentu: dipakai batas rentang tanggal filter riwayat. */
export function ymdIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}

/** Zona waktu yang boleh dipilih untuk organisasi (Indonesia tiga zona + Jepang). */
export const ORG_TIMEZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Tokyo"] as const;
