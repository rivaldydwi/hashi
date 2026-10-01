import { z } from "zod";

/** Tanggal kalender YYYY-MM-DD yang benar-benar ada (menolak 2026-02-31). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);

/** Isian di luar bagian-bagian (sections.ts) pada form tambah kandidat. */
export const createExtrasSchema = z.object({
  // Tanggal tanda tangan formulir persetujuan: OPSIONAL (catatan saja, bukan gerbang visibilitas).
  dataConsentDate: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), isoDate.optional()),
  // Berbagi ke TSK mitra (bawaan: tidak). Mengaktifkan wajib dengan konfirmasi.
  shareWithTsk: z.preprocess((v) => v === "on", z.boolean()),
  shareConfirm: z.preprocess((v) => v === "on", z.boolean()),
});

/** Batas atas tanggal: hari ini + 1 hari (toleransi zona waktu, server jalan di UTC sedangkan LPK di WIB). */
export function latestAllowedDate(now = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const EARLIEST_BIRTH_DATE = "1930-01-01";
