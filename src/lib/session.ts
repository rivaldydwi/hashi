import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { withTenant, type Tx } from "@/db";

/** Ambil user yang login, atau arahkan ke /login. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  return session.user;
}

/**
 * Jalankan query sebagai organisasi user yang sedang login.
 * Inilah cara standar mengakses data tenant dari server component / server action.
 */
export async function tenantQuery<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const user = await requireUser();
  return withTenant(user.organizationId, fn);
}
