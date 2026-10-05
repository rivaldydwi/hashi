import { notFound } from "next/navigation";
import { ActionError } from "@/lib/errors";
import { requireUser, type CurrentUser } from "@/lib/session";

export const isStaff = (me: Pick<CurrentUser, "role">) => me.role === "TSK_ADMIN" || me.role === "TSK_STAFF";

/** Halaman Catatan kegiatan: hanya TSK_ADMIN/TSK_STAFF. Selain itu 404 (LPK tidak boleh tahu halamannya ada). */
export async function requireStaff(): Promise<CurrentUser> {
  const me = await requireUser();
  if (!isStaff(me)) notFound();
  return me;
}

/** Server action: staf TSK, atau ActionError (RLS tetap penjaga akhir). */
export async function requireStaffAction(): Promise<CurrentUser> {
  const me = await requireUser();
  if (!isStaff(me)) throw new ActionError("records.errors.forbidden");
  return me;
}
