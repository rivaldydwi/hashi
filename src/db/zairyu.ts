// Inti murni pelacak kartu izin tinggal 在留カード (T-017; desain di docs/zairyu-card.md): tahap pengingat, tanggal, kartu terkini, penerima.
// Tanpa DB/React/zona waktu: `today` dihitung PEMANGGIL menurut zona organisasi TSK (`ymdIn(now, tz)`). Dipakai aplikasi, seed, dan tes.

export const RESIDENCE_STATUSES = ["ssw1"] as const; // 特定技能1号 saja (jawaban TSK); kolom tetap ada untuk masa depan
/** belum mulai · persiapan · diajukan (申請中) · diajukan + diminta dokumen tambahan (追加資料) · kartu baru diterima · ditolak (不許可) */
export const RENEWAL_STATUSES = ["not_started", "preparing", "applied", "additional_docs", "received", "rejected"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];
/** Kartu baru diambil staf lalu diserahkan ke pekerja, atau pekerja mengambil sendiri. */
export const RECEIVED_BY = ["staff", "worker"] as const;
/** 在留期間 yang boleh dipilih (bulan) untuk 特定技能1号: SATU konfigurasi (konfirmasi ke TSK bila perlu menambah). */
export const PERIOD_OPTIONS = [4, 6, 12] as const;
export const isPeriodOption = (n: number): n is (typeof PERIOD_OPTIONS)[number] => (PERIOD_OPTIONS as readonly number[]).includes(n);

/** Jadwal (jawaban TSK; spreadsheet): persiapan 4 bulan, pengajuan bisa 3 bulan sebelum habis, H-30/H-14/H-7, 特例期間 2 bulan setelah habis. */
export const REMINDER = { prepareMonths: 4, applyMonths: 3, h30: 30, h14: 14, h7: 7, specialPeriodMonths: 2 } as const;

// ---------------------------------------------------------------------------------------------------- tanggal (YYYY-MM-DD, kalender, tanpa zona)
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
const toMs = (ymd: string): number => {
  if (!ymdRe.test(ymd)) throw new Error(`tanggal tidak sah: ${ymd}`);
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
};
const fromMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Selisih hari kalender `to - from` (negatif bila `to` lebih awal). */
export const daysBetween = (from: string, to: string): number => Math.round((toMs(to) - toMs(from)) / 86_400_000);
export const addDays = (ymd: string, n: number): string => fromMs(toMs(ymd) + n * 86_400_000);

/** Tambah (atau kurangi) bulan: hari yang sama di bulan tujuan; bila tidak ada, HARI TERAKHIR bulan itu (31 Mei − 3 bulan = 28 Februari). */
export function addMonths(ymd: string, n: number): string {
  toMs(ymd);
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) - 1, d = Number(ymd.slice(8, 10));
  const t = y * 12 + m + n;
  const ny = Math.floor(t / 12), nm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromMs(Date.UTC(ny, nm, Math.min(d, last)));
}

// ---------------------------------------------------------------------------------------------------- tahap pengingat
/**
 * none · prepare (persiapan, 4 bulan) · can_apply (boleh mengajukan, 3 bulan) · h30 · h14 · h7 · expired (lewat, belum diajukan)
 * waiting_result (結果待ち: sudah diajukan; tidak naik lagi, ada tanda 追加資料 dan 特例期間) · special_overdue (lewat batas 特例期間, belum ada hasil: perhatian)
 * rejected (不許可: perhatian, menghentikan pengingat biasa) · done (kartu baru diterima: berhenti)
 */
export type CardStage = "none" | "prepare" | "can_apply" | "h30" | "h14" | "h7" | "expired" | "waiting_result" | "special_overdue" | "rejected" | "done";

export type CardStageInput = { expiryDate: string; renewalStatus: RenewalStatus; receivedOn?: string | null; today: string };
export type CardStageResult = {
  stage: CardStage;
  /** expiryDate − today (hari kalender; negatif bila sudah lewat). */
  daysLeft: number;
  /** Tanda pada waiting_result: imigrasi meminta dokumen tambahan (追加資料). */
  additionalDocs: boolean;
  /** 特例期間 berlaku sampai tanggal ini (batas = habis + 2 bulan); hanya bila sudah diajukan dan tanggal habis sudah lewat, selain itu null. */
  specialUntil: string | null;
};

export function cardStage(input: CardStageInput): CardStageResult {
  const { expiryDate, renewalStatus, receivedOn, today } = input;
  const daysLeft = daysBetween(today, expiryDate);
  const base = { daysLeft, additionalDocs: false, specialUntil: null as string | null };
  if (renewalStatus === "received" || receivedOn) return { ...base, stage: "done" };
  if (renewalStatus === "rejected") return { ...base, stage: "rejected" };
  if (renewalStatus === "applied" || renewalStatus === "additional_docs") {
    const specialEnd = addMonths(expiryDate, REMINDER.specialPeriodMonths);
    const additionalDocs = renewalStatus === "additional_docs";
    if (today > specialEnd) return { ...base, additionalDocs, specialUntil: specialEnd, stage: "special_overdue" };
    return { ...base, additionalDocs, specialUntil: daysLeft < 0 ? specialEnd : null, stage: "waiting_result" };
  }
  if (daysLeft < 0) return { ...base, stage: "expired" };
  if (daysLeft <= REMINDER.h7) return { ...base, stage: "h7" };
  if (daysLeft <= REMINDER.h14) return { ...base, stage: "h14" };
  if (daysLeft <= REMINDER.h30) return { ...base, stage: "h30" };
  if (today >= addMonths(expiryDate, -REMINDER.applyMonths)) return { ...base, stage: "can_apply" };
  if (today >= addMonths(expiryDate, -REMINDER.prepareMonths)) return { ...base, stage: "prepare" };
  return { ...base, stage: "none" };
}

/** Urutan urgensi untuk daftar "perlu tindakan" (lebih besar = lebih mendesak); `none`/`done` = 0. */
export const STAGE_URGENCY: Record<CardStage, number> = {
  none: 0, done: 0, prepare: 1, can_apply: 2, waiting_result: 3, h30: 4, h14: 5, h7: 6, expired: 7, rejected: 8, special_overdue: 9,
};
/** Tahap yang menuntut tindakan staf (KPI "perlu tindakan segera"): H-30 ke bawah, lewat, ditolak, lewat 特例期間. `waiting_result` = menunggu hasil, bukan tindakan. */
export const ATTENTION_STAGES: readonly CardStage[] = ["h30", "h14", "h7", "expired", "rejected", "special_overdue"];
export const isAttentionStage = (s: CardStage): boolean => ATTENTION_STAGES.includes(s);

// ---------------------------------------------------------------------------------------------------- kartu terkini dan penerima
export type CardRow = { status: string; expiryDate: string; createdAt: string | Date };
const ts = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** Kartu TERKINI seorang pekerja: baris `active` dengan tanggal habis terbesar (seri: dibuat paling akhir). Yang dibatalkan (void) diabaikan. Null bila tidak ada. */
export function currentCard<T extends CardRow>(cards: readonly T[]): T | null {
  const active = cards.filter((c) => c.status === "active");
  if (active.length === 0) return null;
  return active.reduce((a, b) => (b.expiryDate > a.expiryDate || (b.expiryDate === a.expiryDate && ts(b.createdAt) > ts(a.createdAt)) ? b : a));
}

/**
 * Penerima pengingat: 担当 efektif pekerja WAJIB (bila ada), ditambah SEMUA TSK_ADMIN sebagai salinan/cadangan (jawaban TSK). Tanpa duplikat; staf pertama.
 * Tanpa 担当 → hanya Admin (kasus itu sudah punya KPI "pekerja tanpa penanggung jawab").
 */
export function cardRecipients(p: { responsibleStaffId: string | null; adminIds: readonly string[] }): string[] {
  const out: string[] = [];
  if (p.responsibleStaffId) out.push(p.responsibleStaffId);
  for (const id of p.adminIds) if (!out.includes(id)) out.push(id);
  return out;
}
