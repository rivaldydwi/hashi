// Lampiran foto catatan kegiatan: tipe dari ISI berkas, rotasi EXIF diterapkan lalu SEMUA metadata (EXIF, GPS, ICC) dibuang, ukuran dibatasi.
// HEIC/HEIF tidak bisa didekode di image produksi (libvips bawaan sharp tanpa HEVC): ditolak dengan pesan jelas. iPhone mengirim JPEG bila
// atribut `accept` form hanya menyebut JPEG/PNG/WebP (kamera "Paling kompatibel" juga menghasilkan JPEG).
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MAX_ATTACHMENT_BYTES } from "@/db/records-core";

export type ImageKind = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };
export type ImageCheck = { kind: ImageKind } | { error: "tooBig" | "invalidType" | "heic" | "unreadable" };

const MAX_SIDE = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kenali JPEG/PNG/WebP dari byte awal; HEIC/HEIF (kotak ftyp) dikenali supaya bisa diberi pesan khusus. */
export function sniffImage(b: Uint8Array): ImageCheck {
  const at = (off: number, s: string) => b.length >= off + s.length && [...s].every((c, i) => b[off + i] === c.charCodeAt(0));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: { mime: "image/jpeg", ext: "jpg" } };
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { kind: { mime: "image/png", ext: "png" } };
  if (at(0, "RIFF") && at(8, "WEBP")) return { kind: { mime: "image/webp", ext: "webp" } };
  if (at(4, "ftyp") && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].some((brand) => at(8, brand))) return { error: "heic" };
  return { error: "invalidType" };
}

export function checkImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) return { error: "tooBig" };
  return sniffImage(bytes);
}

/** Terapkan rotasi EXIF, perkecil bila > 4096 px, dan buang SEMUA metadata. Format keluaran = format masukan. */
export async function sanitizeImage(bytes: Uint8Array, kind: ImageKind): Promise<Buffer> {
  let img = sharp(bytes, { failOn: "error", limitInputPixels: 80_000_000 }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  img = kind.mime === "image/png" ? img.png({ compressionLevel: 9 }) : kind.mime === "image/webp" ? img.webp({ quality: 85 }) : img.jpeg({ quality: 88, mozjpeg: true });
  return img.toBuffer(); // sharp tidak menyalin metadata kecuali diminta (.withMetadata/.keepMetadata)
}

export function storageRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR || "docs-data");
}

/** <STORAGE_DIR>/activity/<org>/<id>.<ext>. Folder "activity" bukan UUID, jadi tidak tersentuh pembersihan/pemeriksaan dokumen kandidat. */
export function attachmentPath(orgId: string, id: string, ext: string): string {
  if (![orgId, id].every((v) => UUID.test(v))) throw new Error("id lampiran tidak valid");
  if (!["jpg", "png", "webp"].includes(ext)) throw new Error("ekstensi lampiran tidak valid");
  const root = storageRoot();
  const full = path.resolve(root, "activity", orgId, `${id}.${ext}`);
  if (!full.startsWith(path.join(root, "activity") + path.sep)) throw new Error("path lampiran di luar folder penyimpanan");
  return full;
}

export async function writeAttachment(file: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  await writeFile(file, data, { flag: "wx", mode: 0o640 });
}

export async function removeAttachmentFile(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
