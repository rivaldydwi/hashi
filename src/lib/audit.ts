import type { Tx } from "@/db";
import { auditLogs } from "@/db/schema";

import type { AuditEntry } from "@/db/audit-entries";
export type { AuditEntry };

/**
 * Catat perubahan data. Jalankan di transaksi yang sama dengan perubahannya,
 * supaya log dan data selalu konsisten. Jangan pernah memasukkan hash kata sandi.
 */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorOrgId: entry.actorOrgId === undefined ? entry.organizationId : entry.actorOrgId,
    candidateId: entry.candidateId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before,
    after: entry.after,
  });
}
