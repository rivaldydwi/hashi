import { MAX_DOCUMENT_BYTES, safeOriginalName, sniffType, type SniffedType } from "./storage";

export type ReadUpload =
  | { error: "detail.documents.errors.noFile" | "detail.documents.errors.tooBig" | "detail.documents.errors.invalidType" }
  | { bytes: Uint8Array; size: number; originalName: string; mime: SniffedType["mime"]; ext: SniffedType["ext"] };

/**
 * Baca dan periksa file unggahan: ada, tidak kosong, maksimal 10 MB, dan isinya PDF/JPEG/PNG (magic bytes).
 * Ekstensi dan Content-Type dari user diabaikan; hanya nama asli (dibersihkan) yang disimpan untuk tampilan.
 */
export async function readUpload(entry: FormDataEntryValue | null): Promise<ReadUpload> {
  if (!(entry instanceof File) || entry.size === 0) return { error: "detail.documents.errors.noFile" };
  if (entry.size > MAX_DOCUMENT_BYTES) return { error: "detail.documents.errors.tooBig" };
  const bytes = new Uint8Array(await entry.arrayBuffer());
  if (bytes.length > MAX_DOCUMENT_BYTES) return { error: "detail.documents.errors.tooBig" };
  const type = sniffType(bytes);
  if (!type) return { error: "detail.documents.errors.invalidType" };
  return { bytes, size: bytes.length, originalName: safeOriginalName(entry.name), mime: type.mime, ext: type.ext };
}
