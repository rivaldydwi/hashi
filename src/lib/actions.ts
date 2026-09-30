"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { withTenant } from "@/db";
import { users } from "@/db/schema";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

/** Ganti bahasa: simpan di cookie, dan di profil user kalau sedang login. */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
  });

  const session = await auth();
  if (session?.user?.organizationId) {
    // Peran di JWT bisa basi, dan tabel users tidak bergantung pada peran -> null.
    await withTenant(session.user.organizationId, null, (tx) =>
      tx.update(users).set({ locale }).where(eq(users.id, session.user.id)),
    );
  }
  revalidatePath("/", "layout");
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
