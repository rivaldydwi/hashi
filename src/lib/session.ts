import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { withTenant, type Tx } from "@/db";
import { organizations, users, type Role } from "@/db/schema";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  locale: "id" | "ja";
  mustChangePassword: boolean;
  organizationId: string;
  organizationType: "PLATFORM" | "LPK" | "TSK";
  organizationName: string;
};

type LookupResult =
  | { state: "anonymous" }
  | { state: "revoked" } // akun dinonaktifkan / sesi dicabut admin
  | { state: "active"; user: CurrentUser };

/**
 * Baca user yang login LANGSUNG dari database (sekali per request, di-cache).
 * Jadi perubahan dari admin (nonaktif, ganti peran, reset kata sandi) langsung
 * berlaku, tanpa menunggu sesi JWT 8 jam habis.
 */
export const getCurrentUser = cache(async (): Promise<LookupResult> => {
  const session = await auth();
  const s = session?.user;
  if (!s?.id || !s.organizationId) return { state: "anonymous" };

  const row = await withTenant(s.organizationId, async (tx) => {
    const [found] = await tx
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(eq(users.id, s.id))
      .limit(1);
    return found;
  });

  if (!row || !row.user.active) return { state: "revoked" };

  // Sesi dari login sebelum admin me-reset kata sandi tidak berlaku lagi.
  const loginAtMs = s.loginAt ?? 0;
  if (row.user.sessionsRevokedAt && loginAtMs < row.user.sessionsRevokedAt.getTime()) {
    return { state: "revoked" };
  }

  return {
    state: "active",
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.user.role,
      locale: row.user.locale,
      mustChangePassword: row.user.mustChangePassword,
      organizationId: row.org.id,
      organizationType: row.org.type,
      organizationName: row.org.name,
    },
  };
});

/** Ambil user yang login, atau arahkan ke /login (atau /logout kalau aksesnya sudah dicabut). */
export async function requireUser(): Promise<CurrentUser> {
  const result = await getCurrentUser();
  if (result.state === "anonymous") redirect("/login");
  if (result.state === "revoked") redirect("/logout");
  return result.user;
}

/** Seperti requireUser, tapi hanya untuk peran tertentu. Selain itu diarahkan ke beranda. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}

/**
 * Jalankan query sebagai organisasi user yang sedang login.
 * Inilah cara standar mengakses data tenant dari server component / server action.
 */
export async function tenantQuery<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const user = await requireUser();
  return withTenant(user.organizationId, fn);
}
