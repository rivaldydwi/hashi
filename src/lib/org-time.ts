import type { OrgType } from "@/db/schema";

/** Zona waktu tampilan menurut jenis organisasi (LPK/platform: Jakarta, TSK: Tokyo). Kolom organizations.timezone menggantikan ini di Tugas 4. */
export const tzForOrgType = (type: OrgType): string => (type === "TSK" ? "Asia/Tokyo" : "Asia/Jakarta");

/** Tanggal panjang menurut bahasa tampilan, mis. "Jumat, 2 Oktober 2026" / "2026年10月2日金曜日". */
export function longDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
}
