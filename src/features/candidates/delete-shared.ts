// Aturan hapus kandidat yang dipakai server dan UI (tanpa impor server). Aturan sebenarnya dijaga DB (trigger candidates_block_delete).
import type { SelectionDecision } from "@/db/schema";

/** Keputusan TSK yang memblokir hapus permanen (sedang diproses / sudah berangkat). Daftar eksplisit, bukan `>=` pada enum. */
export const DELETE_BLOCKING_DECISIONS: readonly SelectionDecision[] = ["DOCUMENT_PROCESS", "DEPARTED"];

/** Kode kandidat untuk konfirmasi dan audit: 8 karakter pertama id (huruf besar). Bukan data pribadi. */
export const candidateCode = (id: string) => id.slice(0, 8).toUpperCase();

/**
 * Teks yang diterima sebagai konfirmasi: nama kandidat persis, atau kodenya bila kode lebih pendek dari nama.
 * Perbandingan persis (setelah trim); nama tidak diubah huruf besar/kecilnya.
 */
export function confirmationMatches(typed: string, name: string, id: string): boolean {
  const t = typed.trim();
  if (!t) return false;
  const code = candidateCode(id);
  return t === name.trim() || (code.length < name.trim().length && t === code);
}

export type DeleteSummary = {
  documents: number;
  assessmentsLpk: number;
  assessmentsTsk: number;
  notes: number;
  selections: number;
  privateRows: number;
  family: number;
  educations: number;
  works: number;
  certificates: number;
  blocked: boolean;
};
