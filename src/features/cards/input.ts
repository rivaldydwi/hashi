// Validasi masukan form kartu izin tinggal 在留カード (T-018). MURNI (tanpa DB/React), dipakai server action dan dites unit.
// Tanggal = YYYY-MM-DD; `today` dihitung pemanggil menurut zona TSK. Aturan sama dengan CHECK/trigger di migrasi 0025-0026 (DB tetap penjaga akhir).
import { RECEIVED_BY, RENEWAL_STATUSES, addMonths, isPeriodOption, type RenewalStatus } from "@/db/zairyu";

export type CardError =
  | "invalid" | "dateInvalid" | "dateFuture" | "expiryRange" | "periodInvalid" | "statusInvalid" | "fieldRequired"
  | "appliedRequired" | "additionalRequired" | "rejectedRequired" | "datesOrder" | "noteTooLong" | "noteCardNumber"
  | "receivedByInvalid" | "receivedOnRequired" | "handoverNotStaff" | "handoverBeforeReceived" | "newExpiryRequired" | "newExpiryNotLater" | "appliedMissing";
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: CardError };
const fail = (error: CardError): { ok: false; error: CardError } => ({ ok: false, error });

const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
export const validYmd = (v: string): boolean => ymdRe.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rentang tanggal habis yang masuk akal: sejak 2020 sampai 6 tahun dari sekarang (kartu 1号 paling lama 5 tahun total). */
export const EXPIRY_MIN = "2020-01-01";
export const expiryMax = (today: string): string => addMonths(today, 72);

/** Nomor 在留カード (2 huruf + 8 angka + 2 huruf) TIDAK boleh ada di catatan: nomor dan foto kartu disimpan terpisah (T-020), bukan di teks bebas. */
export const looksLikeCardNumber = (text: string): boolean => /\b[A-Za-z]{2}\s?\d{4}\s?\d{4}\s?[A-Za-z]{2}\b/.test(text);

export const NOTE_MAX = 2000;
function parseNote(raw: string): Parsed<string | null> {
  const n = raw.trim();
  if (n.length > NOTE_MAX) return fail("noteTooLong");
  if (looksLikeCardNumber(n)) return fail("noteCardNumber");
  return { ok: true, value: n === "" ? null : n };
}

function parseDate(raw: string, today: string, opts: { future?: boolean } = {}): Parsed<string> {
  const v = raw.trim();
  if (!validYmd(v)) return fail("dateInvalid");
  if (!opts.future && v > today) return fail("dateFuture");
  return { ok: true, value: v };
}

function parsePeriod(raw: string): Parsed<number | null> {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  const n = Number(v);
  return Number.isInteger(n) && isPeriodOption(n) ? { ok: true, value: n } : fail("periodInvalid");
}

export type CardCore = { skillFieldId: string; periodMonths: number | null; expiryDate: string; note: string | null };
export type CardFormValue = CardCore & { renewalStatus: RenewalStatus; appliedOn: string | null; additionalDocsOn: string | null; rejectedOn: string | null };

/** Status yang boleh dipilih lewat form UBAH (received hanya lewat "Terima kartu baru"). */
export const EDITABLE_STATUSES = RENEWAL_STATUSES.filter((s) => s !== "received");
const NEEDS_APPLIED: readonly RenewalStatus[] = ["applied", "additional_docs", "rejected"];

function parseCore(raw: Record<string, string>, today: string): Parsed<CardCore> {
  const skillFieldId = (raw.skillFieldId ?? "").trim();
  if (!uuidRe.test(skillFieldId)) return fail("fieldRequired");
  const expiry = parseDate(raw.expiryDate ?? "", today, { future: true });
  if (!expiry.ok) return expiry;
  if (expiry.value < EXPIRY_MIN || expiry.value > expiryMax(today)) return fail("expiryRange");
  const period = parsePeriod(raw.periodMonths ?? "");
  if (!period.ok) return period;
  const note = parseNote(raw.note ?? "");
  if (!note.ok) return note;
  return { ok: true, value: { skillFieldId, periodMonths: period.value, expiryDate: expiry.value, note: note.value } };
}

/** Kartu PERTAMA: bidang, 在留期間, tanggal habis (+ catatan). Status awal selalu `not_started`. */
export function parseCreate(raw: Record<string, string>, today: string): Parsed<CardFormValue> {
  const core = parseCore(raw, today);
  if (!core.ok) return core;
  return { ok: true, value: { ...core.value, renewalStatus: "not_started", appliedOn: null, additionalDocsOn: null, rejectedOn: null } };
}

/**
 * Ubah kartu: status proses + tanggal yang diwajibkannya. Diajukan/追加資料/不許可 wajib `appliedOn`; 追加資料 wajib `additionalDocsOn`; 不許可 wajib `rejectedOn`
 * (tidak di masa depan, tidak lebih awal dari tanggal pengajuan). Tanggal yang tidak dipakai status itu DIKOSONGKAN (riwayat edit menyimpan nilai lama).
 */
export function parseUpdate(raw: Record<string, string>, today: string): Parsed<CardFormValue> {
  const core = parseCore(raw, today);
  if (!core.ok) return core;
  const status = (raw.renewalStatus ?? "").trim() as RenewalStatus;
  if (!(EDITABLE_STATUSES as readonly string[]).includes(status)) return fail("statusInvalid");
  let appliedOn: string | null = null;
  if (NEEDS_APPLIED.includes(status)) {
    if ((raw.appliedOn ?? "").trim() === "") return fail("appliedRequired");
    const d = parseDate(raw.appliedOn ?? "", today);
    if (!d.ok) return d;
    appliedOn = d.value;
  }
  const later = (key: "additionalDocsOn" | "rejectedOn", required: CardError): Parsed<string> => {
    if ((raw[key] ?? "").trim() === "") return fail(required);
    const d = parseDate(raw[key] ?? "", today);
    if (!d.ok) return d;
    if (appliedOn && d.value < appliedOn) return fail("datesOrder");
    return d;
  };
  let additionalDocsOn: string | null = null;
  let rejectedOn: string | null = null;
  if (status === "additional_docs") {
    const d = later("additionalDocsOn", "additionalRequired");
    if (!d.ok) return d;
    additionalDocsOn = d.value;
  }
  if (status === "rejected") {
    const d = later("rejectedOn", "rejectedRequired");
    if (!d.ok) return d;
    rejectedOn = d.value;
  }
  return { ok: true, value: { ...core.value, renewalStatus: status, appliedOn, additionalDocsOn, rejectedOn } };
}

export type ReceiveValue = {
  receivedOn: string;
  receivedBy: (typeof RECEIVED_BY)[number];
  handedOverOn: string | null;
  next: { skillFieldId: string; periodMonths: number | null; expiryDate: string };
};

/**
 * "Terima kartu baru": tanggal diterima (≥ tanggal pengajuan, tidak di masa depan), diterima oleh staf/pekerja, tanggal serah (hanya bila staf; ≥ diterima), dan data KARTU BARU
 * (tanggal habis > tanggal habis kartu lama; bidang dan 在留期間 bawaan = kartu lama). Kartu lama harus sudah punya tanggal pengajuan (`existing.appliedOn`).
 */
export function parseReceive(raw: Record<string, string>, existing: { appliedOn: string | null; expiryDate: string; skillFieldId: string }, today: string): Parsed<ReceiveValue> {
  if (!existing.appliedOn) return fail("appliedMissing");
  const rec = (raw.receivedOn ?? "").trim() === "" ? fail("receivedOnRequired") : parseDate(raw.receivedOn ?? "", today);
  if (!rec.ok) return rec;
  if (rec.value < existing.appliedOn) return fail("datesOrder");
  const by = (raw.receivedBy ?? "").trim();
  if (!(RECEIVED_BY as readonly string[]).includes(by)) return fail("receivedByInvalid");
  let handedOverOn: string | null = null;
  if ((raw.handedOverOn ?? "").trim() !== "") {
    if (by !== "staff") return fail("handoverNotStaff");
    const d = parseDate(raw.handedOverOn ?? "", today);
    if (!d.ok) return d;
    if (d.value < rec.value) return fail("handoverBeforeReceived");
    handedOverOn = d.value;
  }
  if ((raw.newExpiryDate ?? "").trim() === "") return fail("newExpiryRequired");
  const next = parseDate(raw.newExpiryDate ?? "", today, { future: true });
  if (!next.ok) return next;
  if (next.value <= existing.expiryDate) return fail("newExpiryNotLater");
  if (next.value > expiryMax(today)) return fail("expiryRange");
  const period = parsePeriod(raw.newPeriodMonths ?? "");
  if (!period.ok) return period;
  const fieldRaw = (raw.newSkillFieldId ?? "").trim() || existing.skillFieldId;
  if (!uuidRe.test(fieldRaw)) return fail("fieldRequired");
  return { ok: true, value: { receivedOn: rec.value, receivedBy: by as ReceiveValue["receivedBy"], handedOverOn, next: { skillFieldId: fieldRaw, periodMonths: period.value, expiryDate: next.value } } };
}

/** Tanggal serah ke pekerja untuk kartu yang SUDAH diterima staf: ≥ tanggal diterima, tidak di masa depan. */
export function parseHandover(raw: Record<string, string>, existing: { receivedOn: string | null; receivedBy: string | null }, today: string): Parsed<string> {
  if (existing.receivedBy !== "staff" || !existing.receivedOn) return fail("handoverNotStaff");
  const d = (raw.handedOverOn ?? "").trim() === "" ? fail("dateInvalid") : parseDate(raw.handedOverOn ?? "", today);
  if (!d.ok) return d;
  if (d.value < existing.receivedOn) return fail("handoverBeforeReceived");
  return d;
}

/** Alasan pembatalan: wajib, ≤ 1000 karakter. */
export function parseVoidReason(raw: string): Parsed<string> {
  const r = raw.trim();
  if (r === "") return fail("invalid");
  return { ok: true, value: r.slice(0, 1000) };
}
