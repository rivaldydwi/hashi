import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { userDashboardLayouts } from "@/db/schema";
import { resolveLayout, type ResolvedItem } from "@/db/dashboard-layout";
import type { CurrentUser } from "@/lib/session";

/** Susunan dashboard pengguna: tersimpan (bila ada dan valid) digabung dengan katalog peran, selain itu bawaan. */
export async function loadLayout(user: CurrentUser): Promise<ResolvedItem[]> {
  const row = await withTenant({ orgId: user.organizationId, role: user.role, userId: user.id }, async (tx) =>
    (await tx.select({ layout: userDashboardLayouts.layout }).from(userDashboardLayouts).where(eq(userDashboardLayouts.userId, user.id)))[0],
  );
  return resolveLayout(user.role, row?.layout ?? null);
}
