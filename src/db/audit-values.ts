// Nilai apa yang BOLEH tercatat di audit_logs.before/after. Aturan: audit mencatat NAMA kolom dan nilai yang tidak sensitif dan berbentuk pilihan/status;
// tidak pernah teks bebas, nama orang, email, isi catatan, atau data pribadi kandidat. Satu-satunya jalan menulis audit (`audit()`) memanggil
// `sanitizeAuditPayload`, jadi nilai di luar daftar ini DIBUANG saat ditulis (dan tidak pernah tampil di halaman riwayat).
// Modul murni (tanpa impor), dipakai aplikasi, skrip, dan tes.

/** Kunci struktural (bukan nilai pengguna): daftar nama kolom, nama bagian, hitungan, penanda, id. Selalu diizinkan. */
export const AUDIT_STRUCTURAL_KEYS = ["fields", "section", "rows", "changed", "deleted", "filesTotal", "bodyChanged", "consentForm", "lpkId", "tskId"] as const;

/**
 * Nilai per entitas yang boleh dicatat (pilihan/status/tanggal formulir/kode). Keputusan setiap entri ada alasannya:
 *  - organization: nama ORGANISASI (bukan orang), jenis, negara, bahasa bawaan, zona waktu
 *  - user: peran dan status aktif (BUKAN nama, email, atau bahasa yang dikuasai; itu data pribadi)
 *  - candidate: tahap LPK, keputusan, status berbagi, tanggal formulir persetujuan, kode 8 karakter (BUKAN nama kandidat)
 *  - candidate_note / candidate_assessment: visibility, jenis, periode (BUKAN isi catatan/nilai)
 *  - partnership: status aktif; skill_field: kode; job_order: status
 */
export const AUDIT_VALUE_FIELDS: Record<string, readonly string[]> = {
  organization: ["name", "type", "country", "defaultLocale", "timezone"],
  user: ["role", "active"],
  candidate: ["stage", "decision", "sharedWithTsk", "dataConsentDate", "code"],
  candidate_selection: ["decision"],
  candidate_note: ["visibility"],
  candidate_assessment: ["kind", "period", "visibility"],
  candidate_document: ["type"],
  partnership: ["active"],
  skill_field: ["code"],
  job_order: ["status"],
  placement: ["status"],
  audit_export: ["rows", "from", "to"],
};

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Buang kunci yang bukan struktural dan bukan nilai yang diizinkan untuk entitas ini. */
export function sanitizeAuditPayload(entity: string, payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!isPlain(payload)) return undefined;
  const allowed = new Set<string>([...AUDIT_STRUCTURAL_KEYS, ...(AUDIT_VALUE_FIELDS[entity] ?? [])]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) if (allowed.has(k)) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}
