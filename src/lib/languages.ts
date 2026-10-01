import type { Language, Locale } from "@/db/schema";

/** Urutan tetap bahasa yang dikuasai (id, ja, en): himpunan tampil sama di bahasa tampilan mana pun. */
export const LANGUAGE_ORDER: readonly Language[] = ["id", "ja", "en"];

/** Urutkan dan buang duplikat, supaya tampilan dan data selalu kanonik. */
export function normalizeLanguages(values: readonly string[]): Language[] {
  return LANGUAGE_ORDER.filter((l) => values.includes(l));
}

/**
 * Bahasa tampilan awal pengguna baru: `id` bila bahasa yang dikuasai memuat id, kalau tidak `ja` bila memuat ja, kalau tidak `id`
 * (UI belum punya katalog bahasa Inggris).
 */
export function initialLocale(languages: readonly Language[]): Locale {
  if (languages.includes("id")) return "id";
  if (languages.includes("ja")) return "ja";
  return "id";
}
