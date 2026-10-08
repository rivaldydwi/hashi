// Nilai apa yang BOLEH tercatat di audit_logs.before/after. Aturan: audit mencatat NAMA kolom dan nilai yang tidak sensitif dan berbentuk pilihan/status;
// tidak pernah teks bebas, nama orang, email, isi catatan, atau data pribadi kandidat. Satu-satunya jalan menulis audit (`audit()`) memanggil
// `sanitizeAuditPayload`, jadi nilai di luar daftar ini DIBUANG saat ditulis (dan tidak pernah tampil di halaman riwayat).
// Modul murni (tanpa impor), dipakai aplikasi, skrip, dan tes.

/** Kunci struktural (bukan nilai pengguna): daftar nama kolom, nama bagian, hitungan, penanda, id. Selalu diizinkan. */
export const AUDIT_STRUCTURAL_KEYS = ["fields", "section", "rows", "changed", "deleted", "filesTotal", "bodyChanged", "consentForm", "lpkId", "tskId"] as const;

/**
 * Nilai per entitas yang boleh dicatat (pilihan/status/tanggal formulir/kode). Keputusan setiap entri ada alasannya:
 *  - organization: nama ORGANISASI (bukan orang), jenis, negara, bahasa bawaan, zona waktu
 *  - user: peran, status aktif, dan bahasa yang dikuasai (id/ja/en; bukan data pribadi) (BUKAN nama atau email)
 *  - candidate: tahap LPK, keputusan, status berbagi, tanggal formulir persetujuan, kode 8 karakter (BUKAN nama kandidat)
 *  - candidate_note: visibility. candidate_assessment: visibility, jenis, periode, empat skor 1-5 HANYA untuk LPK_MONTHLY (skor TSK berstatus TSK_ONLY
 *    tidak boleh sampai ke LPK; BUKAN note/follow_up)
 *  - partnership: status aktif; skill_field: kode; job_order: status
 */
/** Empat skor penilaian (1-5). Hanya untuk LPK_MONTHLY; sanitize membuangnya untuk jenis lain. Catatan dan tindak lanjut TIDAK pernah. */
export const AUDIT_SCORE_FIELDS = ["scoreJapanese", "scoreAttitude", "scoreFitness", "scoreMotivation"] as const;

export const AUDIT_VALUE_FIELDS: Record<string, readonly string[]> = {
  organization: ["name", "type", "country", "defaultLocale", "timezone"],
  user: ["role", "active", "languages"],
  candidate: ["stage", "decision", "sharedWithTsk", "dataConsentDate", "code"],
  candidate_selection: ["decision"],
  candidate_note: ["visibility"],
  candidate_assessment: ["kind", "period", "visibility", ...AUDIT_SCORE_FIELDS],
  candidate_document: ["type"],
  partnership: ["active"],
  skill_field: ["code"],
  job_order: ["status", "housing"], // housing = pilihan (provided/allowance/none/unspecified); gaji dan teks bebas TIDAK pernah
  placement: ["status"],
  audit_export: ["rows", "from", "to"],
  // Catatan kegiatan TSK: hanya jenis/status/kategori; TIDAK PERNAH isi teks, nama pekerja, atau nama berkas
  activity_record: ["kind", "status", "workType", "continued"], // continued = dibuat sebagai lanjutan catatan lain (true; id/isi tidak dicatat)
  activity_case: ["category", "status"],
  case_timeline_event: ["status"],
  activity_followup: ["status"],
  activity_attachment: [],
  activity_daily_report: [],
  periodic_interview: ["resultStatus", "reason", "period", "status", "method", "form55", "nonconformity"], // form55 = "filled"; nonconformity = yes|no (TANPA isi form)
  activity_export: ["exportKind", "rows", "clientVersion"],
  // Kartu izin tinggal 在留カード (T-017): hanya kode status/tahap dan diterima-oleh; TANPA tanggal, nomor kartu, catatan, nama pekerja
  residence_card: ["residenceStatus", "renewalStatus", "stage", "receivedBy", "status", "side", "recipients"], // side = front | back (foto kartu, T-020); recipients = jumlah penerima pengingat email (T-022); TANPA nomor/alamat
  // Penanggung jawab pekerja (T-010): hanya cakupan (company | placement); id staf/pekerja/perusahaan tidak dicatat di nilai
  // Data pekerja di Jepang (T-021): hanya NAMA kolom (kunci struktural `fields`); alamat dan telepon tidak pernah tercatat
  worker_jp_profile: [],
  responsible_assignment: ["scope"],
  // Lembar klien (langkah 6): jenis dokumen, mode, bahasa label, jumlah halaman; TANPA nama perusahaan dan isi
  client_sheet_export: ["sheetKind", "mode", "labelLang", "pages"],
};

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Buang kunci yang bukan struktural dan bukan nilai yang diizinkan untuk entitas ini. */
export function sanitizeAuditPayload(entity: string, payload: Record<string, unknown> | undefined, kind?: unknown): Record<string, unknown> | undefined {
  if (!isPlain(payload)) return undefined;
  const allowed = new Set<string>([...AUDIT_STRUCTURAL_KEYS, ...(AUDIT_VALUE_FIELDS[entity] ?? [])]);
  const out: Record<string, unknown> = {};
  // Skor hanya untuk penilaian bulanan LPK (kind di payload); jenis lain: skor dibuang walau kuncinya ada di daftar
  const scoresOk = entity !== "candidate_assessment" || (kind ?? payload.kind) === "LPK_MONTHLY";
  for (const [k, v] of Object.entries(payload)) {
    if (!allowed.has(k)) continue;
    if (!scoresOk && (AUDIT_SCORE_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
