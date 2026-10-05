// Pembaca FormData bersama untuk action Catatan kegiatan (bukan modul "use server": boleh mengekspor apa saja).
import { z } from "zod";

export const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const strOrNull = (fd: FormData, k: string, max = 4000): string | null => {
  const v = str(fd, k).slice(0, max);
  return v === "" ? null : v;
};
export const all = (fd: FormData, k: string): string[] => fd.getAll(k).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

export const uuid = z.uuid();
export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "tanggal tidak valid");
export const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const dtLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
export const uuids = (xs: string[]) => xs.every((x) => uuid.safeParse(x).success);
