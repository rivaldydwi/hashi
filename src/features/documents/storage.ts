// Penyimpanan file dokumen di disk (Docker named volume `docs-data`, lihat compose.yaml).
//
// Tata letak: <STORAGE_DIR>/<org_id>/<candidate_id>/<document_id>.<ext>
// - org_id / candidate_id / document_id selalu UUID yang divalidasi; ext dari daftar tetap.
// - Nama file di disk TIDAK PERNAH memakai nama dari user, dan tidak ada path dari user yang dipakai.
// - Jenis file ditentukan dari isi (magic bytes), bukan ekstensi atau Content-Type kiriman user.

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export { MAX_DOCUMENT_BYTES } from "./storage-limits";

export type SniffedType = { mime: "application/pdf" | "image/jpeg" | "image/png"; ext: "pdf" | "jpg" | "png" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT_BY_MIME: Record<string, "pdf" | "jpg" | "png"> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Kenali PDF / JPEG / PNG dari byte awal. null = bukan salah satunya. */
export function sniffType(b: Uint8Array): SniffedType | null {
  const startsWith = (sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" }; // %PDF-
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  return null;
}

export function extForMime(mime: string) {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`tipe dokumen tidak dikenal: ${mime}`);
  return ext;
}

export function storageRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR || "docs-data");
}

/** Path file di disk. Melempar error bila ada bagian yang bukan UUID / ekstensi tak dikenal (anti path traversal). */
export function documentPath(orgId: string, candidateId: string, documentId: string, ext: string): string {
  if (![orgId, candidateId, documentId].every((v) => UUID.test(v))) throw new Error("id dokumen tidak valid");
  if (!["pdf", "jpg", "png"].includes(ext)) throw new Error("ekstensi dokumen tidak valid");
  const root = storageRoot();
  const full = path.resolve(root, orgId, candidateId, `${documentId}.${ext}`);
  if (!full.startsWith(root + path.sep)) throw new Error("path dokumen di luar folder penyimpanan");
  return full;
}

export async function writeDocument(file: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  await writeFile(file, data, { flag: "wx", mode: 0o640 }); // wx: gagal bila sudah ada (tidak menimpa)
}

export async function removeDocument(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Nama file dari user, hanya untuk TAMPILAN dan nama unduhan: tanpa direktori, karakter kontrol, tanda kutip. */
export function safeOriginalName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f"<>|:*?]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (cleaned || "dokumen").slice(0, 150);
}

/** Header Content-Disposition attachment yang aman (nama ASCII + filename* UTF-8). */
export function attachmentHeader(originalName: string, fallbackBase: string, ext: string): string {
  const ascii = `${fallbackBase}.${ext}`.replace(/[^A-Za-z0-9._-]/g, "_");
  const utf8 = encodeURIComponent(safeOriginalName(originalName)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
