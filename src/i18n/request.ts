import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";

// Bahasa ditentukan dari: cookie pilihan user -> bahasa di profil user -> default (id).
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale = isLocale(fromCookie) ? fromCookie : undefined;

  if (!locale) {
    const session = await auth();
    locale = isLocale(session?.user?.locale) ? session.user.locale : defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Asia/Tokyo",
  };
});
