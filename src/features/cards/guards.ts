// Pembantu bersama action kartu (bukan modul "use server").
import type { Tx } from "@/db";
import { requireStaffAction } from "@/features/records/access";
import { audit } from "@/lib/audit";
import { CardDecryptError, CardKeyError } from "@/lib/card-crypto";
import { ActionError, pgErrorCode } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import type { CurrentUser } from "@/lib/session";
import type { CardError } from "./input";
import { cardEditAccess, getCard, type CardRow } from "./queries";

/** Kunci pesan lengkap untuk galat validasi (cards.errors.<kunci>). */
export const cardErr = (e: CardError) => new ActionError(`cards.errors.${e}`);

/** Muat kartu + pastikan penggunanya boleh mengubah (担当 efektif atau TSK_ADMIN). Pesan jelas sebelum RLS menolak. */
export async function loadEditableCard(tx: Tx, me: Pick<CurrentUser, "id" | "role">, cardId: string, today: string): Promise<CardRow> {
  const card = await getCard(tx, cardId);
  if (!card) throw new ActionError("cards.errors.notFound");
  if (card.status !== "active") throw new ActionError("cards.errors.voided");
  const access = await cardEditAccess(tx, me, card.candidateId, today);
  if (!access.canEdit) throw new ActionError("cards.errors.notEditor");
  return card;
}

/** Galat dari trigger/CHECK DB → kunci pesan yang jelas (bukan teks teknis). null = bukan galat yang dikenal. */
export function mapCardPgError(err: unknown): string | null {
  const code = pgErrorCode(err);
  const msg = String((err as { cause?: { message?: unknown }; message?: unknown })?.cause?.message ?? (err as { message?: unknown })?.message ?? "");
  if (code === "42501") return "cards.errors.notEditor"; // RLS menolak (mis. 担当 baru saja diganti)
  if (code === "23505") return "cards.errors.duplicate";
  if (code === "23514") {
    if (/pengganti/.test(msg) && /dibatalkan/.test(msg)) return "cards.errors.voidChain";
    if (/penggantinya/.test(msg)) return "cards.errors.needSuccessor";
    if (/sudah diterima tidak bisa diubah/.test(msg)) return "cards.errors.receivedLocked";
    return "cards.errors.invalid";
  }
  return null;
}

export const todayOf = (me: CurrentUser) => ymdIn(new Date(), safeTimezone(me.organizationTimezone, me.organizationType));

/** Galat enkripsi → pesan jelas (tanpa detail teknis/kunci). null = bukan galat enkripsi. */
export function mapCryptoError(err: unknown): string | null {
  if (err instanceof CardKeyError) return "cards.errors.keyMissing";
  if (err instanceof CardDecryptError) return "cards.errors.decryptFailed";
  return null;
}

/** Pembungkus action nomor/foto (T-020): pengguna staf TSK, galat yang dikenal → FormState, selain itu dilempar. */
export async function runCard<T extends FormState | { ok: boolean; key?: string }>(fn: (me: CurrentUser, today: string) => Promise<T>, onError: (key: string) => T): Promise<T> {
  const me = await requireStaffAction();
  try {
    return await fn(me, todayOf(me));
  } catch (err) {
    if (err instanceof ActionError) return onError(err.code);
    const key = mapCardPgError(err) ?? mapCryptoError(err);
    if (key) return onError(key);
    throw err;
  }
}

/** Audit kartu di log organisasi TSK. `after` hanya memuat kode (status/sisi), TIDAK PERNAH nomor atau nama berkas. */
export function cardLog(tx: Tx, me: CurrentUser, action: string, id: string, after: Record<string, unknown>) {
  return audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action, entity: "residence_card", entityId: id, after });
}
