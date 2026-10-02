import type { Tx } from "@/db";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/session";

/**
 * Audit data TSK (klien, job order, penempatan): disimpan di log organisasi TSK pelaku (LPK tidak membacanya). Hanya jenis aksi, id,
 * dan NAMA kolom; nama/telepon PIC, catatan, alamat, dan judul tidak pernah dicatat. `candidateId` opsional (penempatan/seleksi).
 */
export async function auditTsk(tx: Tx, me: CurrentUser, action: string, entity: string, entityId: string, fields?: string[], candidateId?: string) {
  await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action, entity, entityId, candidateId, after: fields ? { fields } : undefined });
}
