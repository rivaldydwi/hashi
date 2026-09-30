import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import { organizations, users } from "@/db/schema";

// Kolom yang aman ditampilkan (tanpa hash kata sandi).
const publicUserColumns = {
  id: users.id,
  organizationId: users.organizationId,
  name: users.name,
  email: users.email,
  role: users.role,
  locale: users.locale,
  active: users.active,
  mustChangePassword: users.mustChangePassword,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

export function listUsers(tx: Tx, orgId: string) {
  return tx
    .select(publicUserColumns)
    .from(users)
    .where(eq(users.organizationId, orgId))
    .orderBy(desc(users.active), asc(users.name));
}

export async function getUser(tx: Tx, orgId: string, userId: string) {
  const [row] = await tx
    .select(publicUserColumns)
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, orgId)))
    .limit(1);
  return row;
}

export async function getOrganization(tx: Tx, orgId: string) {
  const [row] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return row;
}

/** Jumlah admin aktif LAIN di organisasi (untuk mencegah organisasi tanpa admin). */
export async function countOtherActiveAdmins(tx: Tx, orgId: string, excludeUserId: string) {
  const [row] = await tx
    .select({ total: count() })
    .from(users)
    .where(
      and(
        eq(users.organizationId, orgId),
        eq(users.active, true),
        inArray(users.role, ["SUPER_ADMIN", "LPK_ADMIN", "TSK_ADMIN"]),
        ne(users.id, excludeUserId),
      ),
    );
  return row?.total ?? 0;
}
