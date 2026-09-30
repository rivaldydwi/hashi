import { redirect } from "next/navigation";
import { withSystem, withTenant, type Tx } from "@/db";
import { requireUser, type CurrentUser } from "@/lib/session";

export type UserAdminScope = {
  me: CurrentUser;
  orgId: string;
  /** Jalankan query dengan hak akses yang sesuai peran pemanggil. */
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Alamat halaman daftar pengguna untuk organisasi ini. */
  basePath: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tentukan organisasi mana yang pengguna-penggunanya boleh dikelola pemanggil:
 * - Admin LPK/TSK: HANYA organisasinya sendiri (lewat RLS, apa pun isi form).
 * - Super admin: organisasi mana pun (targetOrgId), lewat mode sistem.
 * - Peran lain: diarahkan ke beranda.
 */
export async function userAdminScope(targetOrgId?: string | null): Promise<UserAdminScope> {
  const me = await requireUser();

  if (me.role === "LPK_ADMIN" || me.role === "TSK_ADMIN") {
    return {
      me,
      orgId: me.organizationId,
      run: (fn) => withTenant({ orgId: me.organizationId, role: me.role, userId: me.id }, fn),
      basePath: "/users",
    };
  }

  if (me.role === "SUPER_ADMIN") {
    const orgId = targetOrgId && UUID.test(targetOrgId) ? targetOrgId : me.organizationId;
    return {
      me,
      orgId,
      run: (fn) => withSystem(fn),
      basePath: targetOrgId ? `/admin/organizations/${orgId}` : "/users",
    };
  }

  redirect("/");
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
