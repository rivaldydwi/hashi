// Penyimpanan berkas foto 在留カード di disk (T-020). SELALU terenkripsi (src/lib/card-crypto.ts); nama berkas = id foto (UUID), bukan dari pengguna.
// Tata letak: <STORAGE_DIR>/cards/<org_id>/<photo_id>.enc. Folder "cards" bukan UUID, jadi tidak tersentuh pemeriksaan dokumen kandidat; ikut volume `docs-data` (cadangan).
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { photoAad, decryptBytes, encryptBytes } from "@/lib/card-crypto";
import { storageRoot } from "@/features/documents/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cardPhotoPath(orgId: string, photoId: string): string {
  if (![orgId, photoId].every((v) => UUID.test(v))) throw new Error("id foto kartu tidak valid");
  const root = storageRoot();
  const full = path.resolve(root, "cards", orgId, `${photoId}.enc`);
  if (!full.startsWith(path.join(root, "cards") + path.sep)) throw new Error("path foto kartu di luar folder penyimpanan");
  return full;
}

/** Enkripsi lalu tulis (tidak menimpa). Mengembalikan key_id yang dipakai (disimpan di baris foto). */
export async function writeCardPhoto(orgId: string, photoId: string, plain: Uint8Array): Promise<string> {
  const { data, keyId } = encryptBytes(plain, photoAad(photoId));
  const file = cardPhotoPath(orgId, photoId);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  await writeFile(file, data, { flag: "wx", mode: 0o640 });
  return keyId;
}

export async function readCardPhoto(orgId: string, photoId: string): Promise<Buffer> {
  return decryptBytes(await readFile(cardPhotoPath(orgId, photoId)), photoAad(photoId));
}

export async function removeCardPhotoFile(orgId: string, photoId: string): Promise<void> {
  try {
    await unlink(cardPhotoPath(orgId, photoId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
