import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionError } from "@/lib/errors";
import { requireUser, type CurrentUser } from "@/lib/session";

export const uuid = z.uuid();
export const isTskUser = (me: CurrentUser) => me.role === "TSK_ADMIN" || me.role === "TSK_STAFF";

/** Halaman klien / job order: hanya peran TSK. Selain itu 404 (LPK tidak boleh tahu halamannya ada). */
export async function requireTsk(): Promise<CurrentUser> {
  const me = await requireUser();
  if (!isTskUser(me)) notFound();
  return me;
}

/** Untuk server action: peran TSK, atau ActionError (RLS tetap penjaga akhir). */
export async function requireTskAction(): Promise<CurrentUser> {
  const me = await requireUser();
  if (!isTskUser(me)) throw new ActionError("clients.errors.forbidden");
  return me;
}

/** Hapus permanen hanya TSK_ADMIN. */
export function requireAdminAction(me: CurrentUser) {
  if (me.role !== "TSK_ADMIN") throw new ActionError("clients.errors.adminOnly");
}
