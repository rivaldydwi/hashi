// Kelengkapan profil kandidat: persentase kolom yang terisi, diturunkan dari definisi bagian (candidate-sections.ts). Murni (tanpa DB).
import { LIST_SECTIONS, SINGLE_SECTIONS, type FieldDef } from "./candidate-sections";

export type CompletenessInput = {
  /** Baris `candidates`. */
  candidate: Record<string, unknown>;
  /** Baris `candidate_private` (null bila belum ada atau tidak terbaca). */
  priv: Record<string, unknown> | null;
  /** Jumlah baris per bagian berbaris banyak. */
  counts: { family: number; education: number; work: number; certificates: number };
  /** Peran yang tidak membaca data sensitif (sensei) hanya dihitung dari bagian `level: "basic"`. */
  includeSensitive?: boolean;
};

export type Completeness = { filled: number; total: number; percent: number; complete: boolean; missing: string[] };

const isFilled = (f: FieldDef, v: unknown) => (f.kind === "boolean" ? v !== null && v !== undefined : v !== null && v !== undefined && String(v).trim() !== "");

/**
 * Hanya kolom yang berlaku dihitung: catatan riwayat Jepang hanya bila pernah ke Jepang atau pernah ditolak visa. Tiap bagian berbaris banyak
 * (keluarga, pendidikan, kerja, sertifikat) dihitung satu butir: terisi bila ada minimal satu baris. Persentase dibulatkan KE BAWAH, jadi
 * hanya 100 bila benar-benar lengkap.
 */
export function candidateCompleteness(input: CompletenessInput): Completeness {
  const withSensitive = input.includeSensitive !== false;
  const missing: string[] = [];
  let filled = 0;
  let total = 0;
  for (const s of SINGLE_SECTIONS) {
    if (!withSensitive && s.level !== "basic") continue;
    const row = s.table === "candidates" ? input.candidate : input.priv;
    for (const f of s.fields) {
      if (s.key === "japan" && f.name === "japanHistoryNote" && !(input.candidate.everInJapan === true || input.candidate.visaRejectedBefore === true)) continue;
      total++;
      if (row && isFilled(f, row[f.name])) filled++;
      else missing.push(`${s.key}.${f.name}`);
    }
  }
  if (withSensitive) {
    for (const s of LIST_SECTIONS) {
      total++;
      if ((input.counts[s.key as keyof CompletenessInput["counts"]] ?? 0) > 0) filled++;
      else missing.push(s.key);
    }
  }
  const percent = total === 0 ? 100 : Math.floor((filled / total) * 100);
  return { filled, total, percent, complete: filled === total, missing };
}
