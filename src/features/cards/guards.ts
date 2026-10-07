// Pembantu bersama action kartu (bukan modul "use server").
import type { Tx } from "@/db";
import { ActionError, pgErrorCode } from "@/lib/errors";
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
