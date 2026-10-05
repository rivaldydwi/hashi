// Inti murni fitur Catatan kegiatan (tanpa DB/React): daftar nilai, tahun fiskal, keadaan sel wawancara berkala. Dipakai aplikasi, seed, dan tes.
export const WORK_TYPES = ["interview", "consultation", "residence_card", "hospital_visit", "other"] as const;
export const MEETING_METHODS = ["phone", "online", "visit", "in_person"] as const;
export const COUNTERPARTIES = ["client", "worker", "other"] as const;
export const CASE_CATEGORIES = ["trouble", "resignation", "workplace_change", "hospital", "residence", "life_consultation", "other"] as const;
export const INTERVIEW_RESULTS = ["no_issue", "follow_up", "issue", "not_done"] as const;
export const INTERVIEW_REASONS = ["agency", "support", "worker"] as const;
/** Tujuh bagian poin catatan ② (urutan = nomor di PDF). */
export const SECTION_KEYS = ["consultation", "workerView", "currentStatus", "actionTaken", "nextAction", "shared", "pending"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type MeetingSections = Partial<Record<SectionKey, string[]>>;

export const MAX_ATTACHMENTS_PER_RECORD = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------- Tahun fiskal (April - Maret)
/** Tahun mulai tahun fiskal untuk sebuah tanggal YYYY-MM-DD: April 2026 sampai Maret 2027 = 2026. */
export const fiscalYearOf = (iso: string): number => {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
};
/** 12 bulan (YYYY-MM-01) tahun fiskal, April sampai Maret. */
export const fiscalMonths = (fy: number): string[] =>
  Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${m >= 4 ? fy : fy + 1}-${String(m).padStart(2, "0")}-01`;
  });
/** Kuartal (1-4) sebuah bulan dalam tahun fiskal: Apr-Jun = 1, Jul-Sep = 2, Okt-Des = 3, Jan-Mar = 4. */
export const quarterOfMonth = (monthIso: string): 1 | 2 | 3 | 4 => {
  const m = Number(monthIso.slice(5, 7));
  return (Math.floor(((m + 8) % 12) / 3) + 1) as 1 | 2 | 3 | 4;
};
export const fiscalTitle = (fy: number) => `${fy}/4-${fy + 1}/3`;

// ---------------------------------------------------------------- Keadaan sel wawancara berkala
export type InterviewRow = { applicable: boolean; resultStatus: string | null; interviewDate: string | null };
export type CellState = "done" | "pending" | "na" | "notDue";

/**
 * done = ada wawancara dengan status selain not_done; pending = bulan berjalan/lewat tanpa wawancara (atau berstatus not_done) dan berlaku;
 * na = applicable=false; notDue = bulan depan atau sebelum pekerja mulai bekerja (tidak dihitung, tidak ditagih).
 * `today` YYYY-MM-DD menurut zona waktu TSK; `workStart` YYYY-MM-DD (tanggal mulai kerja) atau null.
 */
export function cellState(month: string, row: InterviewRow | undefined, today: string, workStart: string | null): CellState {
  if (row && !row.applicable) return "na";
  if (workStart && month < `${workStart.slice(0, 7)}-01`) return "notDue";
  if (row && row.resultStatus && row.resultStatus !== "not_done") return "done";
  return month <= `${today.slice(0, 7)}-01` ? "pending" : "notDue";
}

/** Gabungkan teks poin ② ke bentuk bersih: buang poin kosong, kunci asing, dan bagian kosong. */
export function cleanSections(input: unknown): MeetingSections {
  const out: MeetingSections = {};
  if (!input || typeof input !== "object") return out;
  for (const k of SECTION_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    if (!Array.isArray(v)) continue;
    const items = v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 50);
    if (items.length) out[k] = items.map((x) => x.slice(0, 2000));
  }
  return out;
}

/** Awalan kode kasus yang ditampilkan: K-<tahun>-<nomor 4 digit> (dibuat trigger; fungsi ini untuk memeriksa bentuknya). */
export const CASE_CODE = /^K-\d{4}-\d{4,}$/;
