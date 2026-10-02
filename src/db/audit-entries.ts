// Modul ini dipakai script di scripts/ (verify-rls) yang berjalan di image Docker stage `tools`, yang hanya
// berisi src/db. Karena itu: JANGAN mengimpor dari src/lib, src/features, atau apa pun di luar src/db,
// dan hanya `import type` (dihapus saat dijalankan) ke modul lain.
import type { CandidateAssessment, CandidateNote, NoteVisibility } from "./schema";

const SCORE_KEYS = ["scoreJapanese", "scoreAttitude", "scoreFitness", "scoreMotivation"];

export type AuditEntry = {
  /** Organisasi tempat log disimpan. Untuk perubahan kandidat: LPK pemilik kandidat. */
  organizationId: string | null;
  /** Organisasi pelaku (LPK atau TSK). Kosong = sama dengan organizationId. */
  actorOrgId?: string | null;
  /** Wajib diisi untuk log yang menyangkut kandidat (dipakai policy RLS agar LPK bisa melihatnya). */
  candidateId?: string;
  actorUserId: string;
  action: string; // mis. "user.create", "organization.update"
  entity: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

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

/**
 * Baris audit untuk penilaian (assessment.create / assessment.update). Disimpan di log LPK PEMILIK kandidat,
 * jadi isi `note` dan `follow_up` TIDAK BOLEH ikut: penilaian TSK berstatus TSK_ONLY tidak boleh sampai ke LPK.
 * Yang dicatat: jenis, periode, NAMA kolom yang berubah, dan perubahan visibility (dari, ke). Tidak pernah isi/nilai.
 */
export function assessmentAuditEntry(p: {
  action: "assessment.create" | "assessment.update";
  assessment: Pick<CandidateAssessment, "id" | "candidateId" | "kind" | "period">;
  lpkOrgId: string;
  /** Organisasi pelaku (LPK penilai, atau TSK penilai). */
  actorOrgId: string;
  actorUserId: string;
  /** Nama kolom yang diisi (create) atau berubah (update). */
  changed: string[];
  visibility?: { from?: NoteVisibility; to: NoteVisibility };
  /**
   * Skor 1-5 (HANYA empat skor; tidak pernah note/follow_up) yang berubah. Dicatat HANYA untuk LPK_MONTHLY: penilaian TSK berstatus TSK_ONLY tidak boleh
   * sampai ke LPK, padahal log kandidat disimpan di LPK pemilik. Untuk jenis TSK, parameter ini diabaikan.
   */
  scores?: { before?: Record<string, number | null>; after: Record<string, number | null> };
}): AuditEntry {
  const keepScores = p.assessment.kind === "LPK_MONTHLY" && p.scores;
  const pick = (o?: Record<string, number | null>) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => SCORE_KEYS.includes(k)));
  return {
    organizationId: p.lpkOrgId,
    actorOrgId: p.actorOrgId,
    candidateId: p.assessment.candidateId,
    actorUserId: p.actorUserId,
    action: p.action,
    entity: "candidate_assessment",
    entityId: p.assessment.id,
    before: p.visibility?.from || keepScores ? { ...(p.visibility?.from ? { visibility: p.visibility.from } : {}), ...(keepScores ? pick(p.scores!.before) : {}) } : undefined,
    after: {
      kind: p.assessment.kind,
      period: p.assessment.period,
      fields: [...p.changed].sort(),
      ...(p.visibility ? { visibility: p.visibility.to } : {}),
      ...(keepScores ? pick(p.scores!.after) : {}),
    },
  };
}
