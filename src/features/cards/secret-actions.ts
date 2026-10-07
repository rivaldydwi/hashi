"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { residenceCardPhotos, residenceCardSecrets } from "@/db/schema";
import { readUpload } from "@/features/documents/upload";
import { str, uuid } from "@/features/records/form";
import { checkImage, sanitizeImage } from "@/features/records/images";
import { decryptText, encryptText, maskCardNumber, normalizeCardNumber, numberAad } from "@/lib/card-crypto";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery } from "@/lib/session";
import { cardLog, loadEditableCard, runCard } from "./guards";
import { removeCardPhotoFile, writeCardPhoto } from "./secret-storage";

// Nomor dan foto 在留カード (T-020). Hanya TSK_ADMIN / 担当 efektif (loadEditableCard + RLS `card_editor`). Nilai asli TIDAK PERNAH masuk audit, log, atau pesan galat.
// Audit (log org TSK): number_set / number_view / photo_set / photo_remove / photo_view, hanya kode (sisi foto), tanpa nilai.

const runForm = (fn: Parameters<typeof runCard<FormState>>[0]) => runCard<FormState>(fn, (key) => ({ status: "error", key }));

export type RevealResult = { ok: true; number: string } | { ok: false; key: string };

/** Simpan atau ganti nomor kartu: format 12 karakter divalidasi, dienkripsi, hanya bentuk tersamar yang ikut tersimpan terbaca. */
export async function saveCardNumber(_prev: FormState, fd: FormData): Promise<FormState> {
  return runForm(async (me, today) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("cards.errors.invalid");
    const number = normalizeCardNumber(str(fd, "number"));
    if (!number) throw new ActionError("cards.errors.numberInvalid");
    let candidateId = "";
    await tenantQuery(async (tx) => {
      const card = await loadEditableCard(tx, me, id, today);
      candidateId = card.candidateId;
      const enc = encryptText(number, numberAad(id)); // CardKeyError bila kunci tidak ada: tidak pernah menyimpan polos
      const values = { numberEnc: enc.value, numberMasked: maskCardNumber(number), keyId: enc.keyId };
      await tx.insert(residenceCardSecrets).values({ cardId: id, organizationId: me.organizationId, candidateId, createdBy: me.id, ...values }).onConflictDoUpdate({ target: residenceCardSecrets.cardId, set: values });
      await cardLog(tx, me, "residence_card.number_set", id, { status: "active" });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    return { status: "success", key: "cards.secrets.numberSaved" };
  });
}

/** Tampilkan nomor lengkap (tombol "Tampilkan"): dicatat di audit SEBELUM nilai dikembalikan (satu transaksi; audit gagal = tidak ada nilai). */
export async function revealCardNumber(cardId: string): Promise<RevealResult> {
  return runCard<RevealResult>(async (me, today) => {
    if (!uuid.safeParse(cardId).success) throw new ActionError("cards.errors.invalid");
    let number = "";
    await tenantQuery(async (tx) => {
      await loadEditableCard(tx, me, cardId, today);
      const [row] = await tx.select({ enc: residenceCardSecrets.numberEnc }).from(residenceCardSecrets).where(eq(residenceCardSecrets.cardId, cardId)).limit(1);
      if (!row) throw new ActionError("cards.errors.noNumber");
      number = decryptText(row.enc, numberAad(cardId));
      await cardLog(tx, me, "residence_card.number_view", cardId, { status: "active" });
    });
    return { ok: true, number };
  }, (key) => ({ ok: false, key }));
}

/** Hapus nomor tersimpan (koreksi). Foto tidak ikut; foto dihapus per sisi. */
export async function clearCardNumber(_prev: FormState, fd: FormData): Promise<FormState> {
  return runForm(async (me, today) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("cards.errors.invalid");
    let candidateId = "";
    await tenantQuery(async (tx) => {
      const card = await loadEditableCard(tx, me, id, today);
      candidateId = card.candidateId;
      const gone = await tx.delete(residenceCardSecrets).where(eq(residenceCardSecrets.cardId, id)).returning({ id: residenceCardSecrets.cardId });
      if (gone.length === 0) throw new ActionError("cards.errors.noNumber");
      await cardLog(tx, me, "residence_card.number_remove", id, { status: "active" });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    return { status: "success", key: "cards.secrets.numberRemoved" };
  });
}

/**
 * Unggah foto kartu (depan/belakang): jenis dari ISI berkas (JPG/PNG/PDF), foto dibersihkan sharp (rotasi EXIF lalu buang semua metadata), maks 10 MB,
 * dienkripsi sebelum ditulis ke disk. Sisi yang sama diganti (yang lama ditandai dihapus dan berkasnya dibuang SETELAH commit).
 */
export async function uploadCardPhoto(_prev: FormState, fd: FormData): Promise<FormState> {
  return runForm(async (me, today) => {
    const id = str(fd, "id");
    const side = str(fd, "side");
    if (!uuid.safeParse(id).success || (side !== "front" && side !== "back")) throw new ActionError("cards.errors.invalid");
    const up = await readUpload(fd.get("file"));
    if ("error" in up) throw new ActionError(up.error);
    let bytes: Uint8Array = up.bytes;
    if (up.mime !== "application/pdf") {
      const img = checkImage(up.bytes);
      if ("error" in img) throw new ActionError("cards.errors.photoUnreadable");
      try {
        bytes = await sanitizeImage(up.bytes, img.kind);
      } catch {
        throw new ActionError("cards.errors.photoUnreadable");
      }
    }
    const photoId = randomUUID();
    let candidateId = "";
    let orgId = "";
    const replaced: string[] = [];
    let written = false;
    try {
      await tenantQuery(async (tx) => {
        const card = await loadEditableCard(tx, me, id, today);
        candidateId = card.candidateId;
        orgId = card.organizationId;
        const old = await tx
          .update(residenceCardPhotos)
          .set({ removedAt: new Date(), removedBy: me.id })
          .where(and(eq(residenceCardPhotos.cardId, id), eq(residenceCardPhotos.side, side), isNull(residenceCardPhotos.removedAt)))
          .returning({ id: residenceCardPhotos.id });
        replaced.push(...old.map((o) => o.id));
        const keyId = await writeCardPhoto(orgId, photoId, bytes); // CardKeyError sebelum apa pun tertulis bila kunci tidak ada
        written = true;
        await tx.insert(residenceCardPhotos).values({ id: photoId, cardId: id, organizationId: orgId, candidateId, side, mime: up.mime, sizeBytes: bytes.length, keyId, createdBy: me.id });
        await cardLog(tx, me, "residence_card.photo_set", id, { side });
      });
    } catch (err) {
      if (written) await removeCardPhotoFile(orgId, photoId).catch(() => {}); // transaksi dibatalkan: jangan tinggalkan berkas yatim
      throw err;
    }
    for (const oldId of replaced) await removeCardPhotoFile(orgId, oldId).catch((e) => console.error("gagal menghapus berkas foto kartu lama", e instanceof Error ? e.name : "error"));
    revalidatePath(`/records/workers/${candidateId}`);
    return { status: "success", key: "cards.secrets.photoSaved" };
  });
}

/** Hapus satu foto: baris ditandai dihapus (jejak), berkas terenkripsi di disk dibuang SETELAH commit. */
export async function removeCardPhoto(_prev: FormState, fd: FormData): Promise<FormState> {
  return runForm(async (me, today) => {
    const photoId = str(fd, "photoId");
    if (!uuid.safeParse(photoId).success) throw new ActionError("cards.errors.invalid");
    let candidateId = "";
    let orgId = "";
    await tenantQuery(async (tx) => {
      const [p] = await tx.select({ cardId: residenceCardPhotos.cardId, side: residenceCardPhotos.side, removedAt: residenceCardPhotos.removedAt }).from(residenceCardPhotos).where(eq(residenceCardPhotos.id, photoId)).limit(1);
      if (!p || p.removedAt) throw new ActionError("cards.errors.notFound");
      const card = await loadEditableCard(tx, me, p.cardId, today);
      candidateId = card.candidateId;
      orgId = card.organizationId;
      await tx.update(residenceCardPhotos).set({ removedAt: new Date(), removedBy: me.id }).where(eq(residenceCardPhotos.id, photoId));
      await cardLog(tx, me, "residence_card.photo_remove", p.cardId, { side: p.side });
    });
    await removeCardPhotoFile(orgId, photoId).catch((e) => console.error("gagal menghapus berkas foto kartu", e instanceof Error ? e.name : "error"));
    revalidatePath(`/records/workers/${candidateId}`);
    return { status: "success", key: "cards.secrets.photoRemoved" };
  });
}
