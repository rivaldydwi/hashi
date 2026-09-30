export const locales = ["id", "ja"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "id";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
