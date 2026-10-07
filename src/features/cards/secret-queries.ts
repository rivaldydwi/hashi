// Kueri nomor/foto kartu untuk TAMPILAN (T-020). TIDAK PERNAH memilih `number_enc`: sandi hanya dibaca action "Tampilkan" (`revealCardNumber`).
// Hanya dipanggil bila pengguna boleh (TSK_ADMIN / 担当); RLS tetap penjaga akhir: staf lain mendapat 0 baris.
import { and, asc, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { residenceCardPhotos, residenceCardSecrets } from "@/db/schema";

export type CardPhotoMeta = { id: string; side: "front" | "back"; mime: string; sizeBytes: number; createdAt: Date };
export type CardSecretsMeta = { numberMasked: string | null; photos: CardPhotoMeta[] };

export async function loadSecretsMeta(tx: Tx, cardIds: string[]): Promise<Record<string, CardSecretsMeta>> {
  const out: Record<string, CardSecretsMeta> = Object.fromEntries(cardIds.map((id) => [id, { numberMasked: null, photos: [] }]));
  if (cardIds.length === 0) return out;
  const numbers = await tx.select({ cardId: residenceCardSecrets.cardId, masked: residenceCardSecrets.numberMasked }).from(residenceCardSecrets).where(inArray(residenceCardSecrets.cardId, cardIds));
  for (const n of numbers) out[n.cardId].numberMasked = n.masked;
  const photos = await tx
    .select({ id: residenceCardPhotos.id, cardId: residenceCardPhotos.cardId, side: residenceCardPhotos.side, mime: residenceCardPhotos.mime, sizeBytes: residenceCardPhotos.sizeBytes, createdAt: residenceCardPhotos.createdAt })
    .from(residenceCardPhotos)
    .where(and(inArray(residenceCardPhotos.cardId, cardIds), isNull(residenceCardPhotos.removedAt)))
    .orderBy(asc(residenceCardPhotos.side));
  for (const p of photos) out[p.cardId].photos.push({ id: p.id, side: p.side as "front" | "back", mime: p.mime, sizeBytes: p.sizeBytes, createdAt: p.createdAt });
  return out;
}
