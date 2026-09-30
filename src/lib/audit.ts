import type { Tx } from "@/db";
import { auditLogs } from "@/db/schema";

type AuditEntry = {
  organizationId: string | null;
  actorUserId: string;
  action: string; // mis. "user.create", "organization.update"
  entity: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

/**
 * Catat perubahan data. Jalankan di transaksi yang sama dengan perubahannya,
 * supaya log dan data selalu konsisten. Jangan pernah memasukkan hash kata sandi.
 */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before,
    after: entry.after,
  });
}
