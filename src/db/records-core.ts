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


// ---------------------------------------------------------------- Aturan kuartal 定期面談 (T-008; sumber: staf TSK, 2026-10-06)
// Wajib MINIMAL SEKALI per kuartal tahun fiskal (Apr-Jun, Jul-Sep, Okt-Des, Jan-Mar), sejak pekerja mulai bekerja di perusahaan; boleh lebih sering.
// Kuartal "wajib" bila pekerja bekerja minimal satu hari di kuartal itu (penempatan ACTIVE maupun ENDED).
/** Rentang penempatan: tanggal mulai kerja .. tanggal berhenti (null = masih bekerja), YYYY-MM-DD, keduanya inklusif. */
export type WorkSpan = { start: string; end: string | null };
/** Wawancara berkala satu baris: `date` = tanggal wawancara bila diisi, jika tidak awal bulan periode. */
export type QuarterInterview = { applicable: boolean; resultStatus: string | null; date: string };
export type QuarterState = "done" | "pending" | "na" | "notDue" | "notRequired";

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Awal dan akhir (inklusif) kuartal 1-4 tahun fiskal `fy`: Q1 = Apr-Jun fy, ..., Q4 = Jan-Mar fy+1. */
export function fiscalQuarterRange(fy: number, q: 1 | 2 | 3 | 4): { start: string; end: string } {
  const firstMonth = 4 + (q - 1) * 3; // 4, 7, 10, 13
  const lastMonth = firstMonth + 2;
  const ym = (m: number) => (m > 12 ? { y: fy + 1, m: m - 12 } : { y: fy, m });
  const a = ym(firstMonth);
  const b = ym(lastMonth);
  return { start: `${a.y}-${String(a.m).padStart(2, "0")}-01`, end: `${b.y}-${String(b.m).padStart(2, "0")}-${String(lastDayOfMonth(b.y, b.m)).padStart(2, "0")}` };
}
export const FISCAL_QUARTERS = [1, 2, 3, 4] as const;
/** Tahun fiskal + kuartal untuk sebuah tanggal YYYY-MM-DD. */
export const quarterOfDate = (iso: string): { fy: number; q: 1 | 2 | 3 | 4 } => ({ fy: fiscalYearOf(iso), q: quarterOfMonth(`${iso.slice(0, 7)}-01`) });
/** Bekerja minimal satu hari di kuartal itu (salah satu rentang penempatan beririsan dengan kuartal). */
export function workedInQuarter(spans: WorkSpan[], fy: number, q: 1 | 2 | 3 | 4): boolean {
  const r = fiscalQuarterRange(fy, q);
  return spans.some((s) => s.start <= r.end && (s.end === null || s.end >= r.start));
}
/** Bekerja minimal satu hari di tahun fiskal itu (wajib masuk laporan tahunan imigrasi, termasuk yang berhenti di tengah tahun). */
export const workedInFiscalYear = (spans: WorkSpan[], fy: number): boolean => FISCAL_QUARTERS.some((q) => workedInQuarter(spans, fy, q));

/**
 * Keadaan satu kuartal untuk satu pekerja.
 *  notRequired = tidak bekerja sehari pun di kuartal itu (tidak ditagih, tidak ditampilkan sebagai wajib);
 *  notDue      = kuartal belum dimulai (kuartal depan tidak ditagih);
 *  done        = ada >= 1 wawancara berlaku (status selain 未実施) bertanggal di kuartal itu;
 *  na          = tidak ada yang selesai tetapi ada baris "tidak berlaku" (対象外) di kuartal itu: tidak ditagih;
 *  pending     = kuartal sudah berjalan/lewat tanpa wawancara selesai.
 * `today` YYYY-MM-DD menurut zona waktu TSK.
 */
export function quarterState(fy: number, q: 1 | 2 | 3 | 4, interviews: QuarterInterview[], today: string, spans: WorkSpan[]): QuarterState {
  if (!workedInQuarter(spans, fy, q)) return "notRequired";
  const r = fiscalQuarterRange(fy, q);
  if (r.start > today) return "notDue";
  const inQ = interviews.filter((i) => i.date >= r.start && i.date <= r.end);
  if (inQ.some((i) => i.applicable && i.resultStatus && i.resultStatus !== "not_done")) return "done";
  if (inQ.some((i) => !i.applicable)) return "na";
  return "pending";
}

/** Penanda satu BULAN di grid (bulan tetap tampil karena wawancara boleh bulanan): done / na / none (belum ada, bukan tanda merah) / notDue (di luar masa kerja atau bulan depan). */
export type MonthMark = "done" | "na" | "none" | "notDue";
export function monthMark(month: string, row: InterviewRow | undefined, today: string, spans: WorkSpan[]): MonthMark {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const end = `${month.slice(0, 8)}${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  const worked = spans.some((s) => s.start <= end && (s.end === null || s.end >= month));
  if (row && !row.applicable) return "na";
  if (!worked) return "notDue";
  if (row && row.resultStatus && row.resultStatus !== "not_done") return "done";
  return month > `${today.slice(0, 7)}-01` ? "notDue" : "none";
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
