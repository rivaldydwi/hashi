import type { CandidateNote, NoteVisibility } from "@/db/schema";
import type { AuditEntry } from "@/lib/audit";

/**
 * Baris audit untuk aksi pada catatan TSK.
 *
 * ATURAN: baris audit kandidat disimpan di log LPK PEMILIK (organizationId = LPK), sehingga LPK
 * membacanya. Isi catatan TIDAK BOLEH ikut tercatat, karena catatan berstatus TSK_ONLY tidak
 * boleh sampai ke LPK. Yang dicatat hanya id catatan dan visibility (dari, ke). Fungsi ini sengaja
 * satu-satunya jalan membuat baris audit catatan, dan tidak pernah membaca `note.body`.
 */
export function noteAuditEntry(p: {
  action: "note.create" | "note.update" | "note.visibility_change";
  note: Pick<CandidateNote, "id" | "candidateId" | "tskOrgId">;
  lpkOrgId: string;
  actorUserId: string;
  /** Visibility sebelum perubahan (kosong untuk note.create). */
  from?: NoteVisibility;
  /** Visibility sesudah perubahan. */
  to: NoteVisibility;
  /** Hanya penanda bahwa isi berubah (tanpa isinya). */
  bodyChanged?: boolean;
}): AuditEntry {
  return {
    organizationId: p.lpkOrgId,
    actorOrgId: p.note.tskOrgId,
    candidateId: p.note.candidateId,
    actorUserId: p.actorUserId,
    action: p.action,
    entity: "candidate_note",
    entityId: p.note.id,
    before: p.from ? { visibility: p.from } : undefined,
    after: p.bodyChanged ? { visibility: p.to, bodyChanged: true } : { visibility: p.to },
  };
}
