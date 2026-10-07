// Kueri kartu izin tinggal 在留カード untuk satu pekerja (T-018). Semua lewat RLS TSK (tenantQuery/withTenant): staf lain org / LPK / sensei tidak melihat baris.
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { responsibleOfWorker } from "@/db/responsibility-queries";
import { currentCard } from "@/db/zairyu";
import { candidates, residenceCards } from "@/db/schema";
import { revisionsOf, type RevisionRow } from "@/features/records/queries";
import type { CurrentUser } from "@/lib/session";
import { loadSecretsMeta, type CardSecretsMeta } from "./secret-queries";

export type CardRow = typeof residenceCards.$inferSelect;

/** Semua kartu pekerja (terbaru dulu): aktif maupun yang dibatalkan (void ditandai di UI). */
export async function cardsOfWorker(tx: Tx, candidateId: string): Promise<CardRow[]> {
  return tx.select().from(residenceCards).where(eq(residenceCards.candidateId, candidateId)).orderBy(desc(residenceCards.expiryDate), desc(residenceCards.createdAt));
}

export async function getCard(tx: Tx, id: string): Promise<CardRow | null> {
  const [row] = await tx.select().from(residenceCards).where(eq(residenceCards.id, id)).limit(1);
  return row ?? null;
}

/** Bidang kerja pekerja (bawaan form kartu pertama). */
export async function workerFieldId(tx: Tx, candidateId: string): Promise<string | null> {
  const [c] = await tx.select({ f: candidates.fieldId }).from(candidates).where(and(eq(candidates.id, candidateId))).limit(1);
  return c?.f ?? null;
}

/**
 * Siapa boleh mengubah kartu pekerja ini (jawaban TSK no. 7): TSK_ADMIN, atau penanggung jawab EFEKTIF pekerja (T-010) yang sedang login.
 * Hanya penilaian untuk tampilan dan pemeriksaan awal action; RLS (`card_editor`) tetap penjaga akhir. Pekerja yang tidak punya penempatan aktif: hanya Admin.
 */
export async function cardEditAccess(tx: Tx, me: Pick<CurrentUser, "id" | "role">, candidateId: string, today: string): Promise<{ canEdit: boolean; activeWorker: boolean; responsible: { staffId: string | null; name: string | null } | null }> {
  const resp = await responsibleOfWorker(tx, candidateId, today);
  const isAdmin = me.role === "TSK_ADMIN";
  return {
    canEdit: isAdmin || (resp?.staffId != null && resp.staffId === me.id),
    activeWorker: resp !== null,
    responsible: resp ? { staffId: resp.staffId, name: resp.name } : null,
  };
}

export type CardSectionData = {
  cards: CardRow[];
  current: CardRow | null;
  revisions: RevisionRow[];
  defaultFieldId: string | null;
  access: Awaited<ReturnType<typeof cardEditAccess>>;
  /** Nomor tersamar + foto per kartu (T-020): HANYA diisi bila pengguna boleh (TSK_ADMIN / 担当); selain itu kosong dan tidak dikueri. */
  secrets: Record<string, CardSecretsMeta>;
};

/** Semua data bagian "在留カード" di halaman pekerja (urut, satu transaksi: kueri berurutan, bukan paralel pada koneksi yang sama). */
export async function loadCardSection(tx: Tx, me: Pick<CurrentUser, "id" | "role">, candidateId: string, today: string): Promise<CardSectionData> {
  const cards = await cardsOfWorker(tx, candidateId);
  const current = currentCard(cards);
  const revisions = current ? await revisionsOf(tx, "residence_card", current.id) : [];
  const defaultFieldId = await workerFieldId(tx, candidateId);
  const access = await cardEditAccess(tx, me, candidateId, today);
  const secrets = access.canEdit ? await loadSecretsMeta(tx, cards.filter((c) => c.status === "active").map((c) => c.id)) : {};
  return { cards, current, revisions, defaultFieldId, access, secrets };
}
