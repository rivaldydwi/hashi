import type { CandidateStage, Role, SelectionDecision } from "@/db/schema";
import type { Level } from "./sections";

/** Keputusan TSK yang membuka hak edit isi data (sama dengan tsk_editable_decision di database). */
export const TSK_EDIT_DECISIONS: readonly SelectionDecision[] = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"];

export const isTskRole = (role: Role) => role === "TSK_ADMIN" || role === "TSK_STAFF";

export type ContentAccess = {
  canEdit: boolean;
  canDelete: boolean;
  /** Alasan baca-saja untuk TSK (kunci di detail.readOnly.*). */
  readOnlyReason: "needsDecision" | "withdrawn" | null;
};

/**
 * Cermin dari aturan RLS untuk menyusun tampilan (tombol, penjelasan). Yang benar-benar menjaga data
 * tetap RLS di database; fungsi ini hanya supaya pengguna tidak melihat tombol yang pasti ditolak.
 */
export function contentAccess(role: Role, stage: CandidateStage, myDecision: SelectionDecision | null): ContentAccess {
  if (role === "LPK_ADMIN") return { canEdit: true, canDelete: true, readOnlyReason: null };
  if (isTskRole(role)) {
    if (stage === "WITHDRAWN") return { canEdit: false, canDelete: false, readOnlyReason: "withdrawn" };
    const ok = myDecision !== null && TSK_EDIT_DECISIONS.includes(myDecision);
    return { canEdit: ok, canDelete: false, readOnlyReason: ok ? null : "needsDecision" };
  }
  return { canEdit: false, canDelete: false, readOnlyReason: null };
}

/** Sensei hanya melihat bagian level basic; sisanya tidak dirender sama sekali. */
export function canSeeLevel(role: Role, level: Level) {
  return level === "basic" || role === "LPK_ADMIN" || isTskRole(role);
}

/** Keputusan TSK yang membuka penilaian interview TSK (sama dengan tsk_interview_decision di database). Daftar eksplisit, bukan `>=`. */
export const TSK_INTERVIEW_DECISIONS: readonly SelectionDecision[] = ["PASSED_TSK_INTERVIEW", "SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"];
