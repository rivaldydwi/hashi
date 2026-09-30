import { z } from "zod";
import { gender } from "@/db/schema";

/** Tanggal kalender YYYY-MM-DD yang benar-benar ada (menolak 2026-02-31). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);

/** Form tambah kandidat: data minimal. Sisanya dilengkapi di halaman detail. */
export const addCandidateSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  gender: z.enum(gender.enumValues),
  birthDate: isoDate,
  field: z.string().trim().min(1).max(120),
  // Persetujuan berbagi data ke TSK mitra, diambil saat siswa mendaftar. Wajib.
  dataConsentDate: isoDate,
});

/** Batas atas tanggal: hari ini + 1 hari (toleransi zona waktu, server jalan di UTC sedangkan LPK di WIB). */
export function latestAllowedDate(now = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const EARLIEST_BIRTH_DATE = "1930-01-01";
