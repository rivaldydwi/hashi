import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { auditLogs, organizations, users } from "@/db/schema";
import { sanitizeAuditPayload } from "@/db/audit-values";

import type { AuditEntry } from "@/db/audit-entries";
export type { AuditEntry };

/**
 * Catat perubahan data. Jalankan di transaksi yang sama dengan perubahannya,
 * supaya log dan data selalu konsisten. Jangan pernah memasukkan hash kata sandi.
 *
 * - `before`/`after` disaring `sanitizeAuditPayload` (src/db/audit-values.ts): hanya kunci struktural dan nilai pilihan/status yang diizinkan.
 * - Potret pelaku (nama, peran, organisasi) disimpan di baris saat kejadian, jadi riwayat tetap utuh walau pengguna diganti nama atau dihapus.
 *   Untuk entri LINTAS organisasi (pelaku bukan organisasi penyimpan log, mis. TSK mengubah kandidat LPK) NAMA ORANG tidak disimpan: pihak lain
 *   hanya boleh tahu organisasi pelaku.
 */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  const actorOrgId = entry.actorOrgId === undefined ? entry.organizationId : entry.actorOrgId;
  const crossOrg = actorOrgId !== entry.organizationId;
  const [who] = await tx
    .select({ name: users.name, role: users.role, orgName: organizations.name })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, entry.actorUserId))
    .limit(1);
  const kind = entry.after?.kind ?? entry.before?.kind; // jenis penilaian menentukan boleh-tidaknya skor tercatat
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorOrgId,
    candidateId: entry.candidateId,
    actorUserId: entry.actorUserId,
    actorName: crossOrg ? null : (who?.name ?? null),
    actorRole: who?.role ?? null,
    actorOrgName: who?.orgName ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: sanitizeAuditPayload(entry.entity, entry.before, kind),
    after: sanitizeAuditPayload(entry.entity, entry.after, kind),
  });
}
