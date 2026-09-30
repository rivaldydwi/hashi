import { asc, desc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db";
import { organizations, partnerships } from "@/db/schema";

const lpk = alias(organizations, "lpk");
const tsk = alias(organizations, "tsk");

/** Semua kemitraan (opsional: hanya yang melibatkan satu organisasi). Jalankan lewat withSystem. */
export function listPartnerships(tx: Tx, orgId?: string) {
  const query = tx
    .select({
      id: partnerships.id,
      active: partnerships.active,
      createdAt: partnerships.createdAt,
      lpkId: lpk.id,
      lpkName: lpk.name,
      tskId: tsk.id,
      tskName: tsk.name,
    })
    .from(partnerships)
    .innerJoin(lpk, eq(lpk.id, partnerships.lpkId))
    .innerJoin(tsk, eq(tsk.id, partnerships.tskId))
    .orderBy(desc(partnerships.active), asc(tsk.name), asc(lpk.name));
  return orgId ? query.where(or(eq(partnerships.lpkId, orgId), eq(partnerships.tskId, orgId))) : query;
}

export function listOrganizationsByType(tx: Tx, type: "LPK" | "TSK") {
  return tx
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.type, type))
    .orderBy(asc(organizations.name));
}
