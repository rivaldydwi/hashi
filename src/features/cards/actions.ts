"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { assertSkillFieldUsable } from "@/features/candidates/guards";
import { cardStage, currentCard } from "@/db/zairyu";
import { residenceCards } from "@/db/schema";
import { requireStaffAction } from "@/features/records/access";
import { str, uuid } from "@/features/records/form";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery, type CurrentUser } from "@/lib/session";
import { cardErr, loadEditableCard, mapCardPgError } from "./guards";
import { parseCreate, parseHandover, parseReceive, parseUpdate, parseVoidReason } from "./input";
import { cardEditAccess, cardsOfWorker } from "./queries";

// Server action kartu izin tinggal 在留カード (T-018). Tulis = TSK_ADMIN atau 担当 efektif pekerja; RLS (`card_editor`) dan trigger tetap penjaga akhir.
// Audit di log organisasi TSK: HANYA kode status/tahap, `receivedBy`, dan NAMA kolom yang berubah (tanpa tanggal, catatan, nama, nomor).

const raw = (fd: FormData): Record<string, string> => Object.fromEntries([...fd.entries()].filter((e): e is [string, string] => typeof e[1] === "string"));
const todayOf = (me: CurrentUser) => ymdIn(new Date(), safeTimezone(me.organizationTimezone, me.organizationType));
const ok = (key = "cards.saved"): FormState => ({ status: "success", key });

async function run(fn: (me: CurrentUser, today: string) => Promise<FormState>): Promise<FormState> {
  const me = await requireStaffAction();
  try {
    return await fn(me, todayOf(me));
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    const key = mapCardPgError(err);
    if (key) return { status: "error", key };
    throw err;
  }
}

const log = (tx: Parameters<typeof audit>[0], me: CurrentUser, action: string, id: string, after: Record<string, unknown>) =>
  audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action, entity: "residence_card", entityId: id, after });

/** Kartu PERTAMA pekerja (belum ada kartu aktif): bidang, 在留期間, tanggal habis. */
export async function createCard(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me, today) => {
    const candidateId = str(fd, "candidateId");
    if (!uuid.safeParse(candidateId).success) throw new ActionError("cards.errors.invalid");
    const parsed = parseCreate(raw(fd), today);
    if (!parsed.ok) throw cardErr(parsed.error);
    const v = parsed.value;
    await tenantQuery(async (tx) => {
      const access = await cardEditAccess(tx, me, candidateId, today);
      if (!access.activeWorker) throw new ActionError("cards.errors.workerNotActive");
      if (!access.canEdit) throw new ActionError("cards.errors.notEditor");
      if (currentCard(await cardsOfWorker(tx, candidateId))) throw new ActionError("cards.errors.alreadyHasCard");
      await assertSkillFieldUsable(tx, v.skillFieldId);
      const [row] = await tx.insert(residenceCards).values({
        organizationId: me.organizationId, createdBy: me.id, candidateId, skillFieldId: v.skillFieldId, periodMonths: v.periodMonths, expiryDate: v.expiryDate, note: v.note, renewalStatus: "not_started",
      }).returning({ id: residenceCards.id });
      await log(tx, me, "residence_card.create", row.id, { residenceStatus: "ssw1", renewalStatus: "not_started", stage: cardStage({ expiryDate: v.expiryDate, renewalStatus: "not_started", today }).stage });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    return ok();
  });
}

/** Ubah data kartu dan status proses (bukan "received": lihat receiveCard). */
export async function updateCard(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me, today) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("cards.errors.invalid");
    const parsed = parseUpdate(raw(fd), today);
    if (!parsed.ok) throw cardErr(parsed.error);
    const v = parsed.value;
    let candidateId = "";
    await tenantQuery(async (tx) => {
      const card = await loadEditableCard(tx, me, id, today);
      candidateId = card.candidateId;
      if (card.renewalStatus === "received") throw new ActionError("cards.errors.receivedLocked");
      await assertSkillFieldUsable(tx, v.skillFieldId, card.skillFieldId);
      const next = { skillFieldId: v.skillFieldId, periodMonths: v.periodMonths, expiryDate: v.expiryDate, renewalStatus: v.renewalStatus, appliedOn: v.appliedOn, additionalDocsOn: v.additionalDocsOn, rejectedOn: v.rejectedOn, note: v.note };
      const fields = (Object.keys(next) as Array<keyof typeof next>).filter((k) => (card[k] ?? null) !== (next[k] ?? null)).sort();
      if (fields.length === 0) throw new ActionError("cards.errors.noChange");
      await tx.update(residenceCards).set(next).where(eq(residenceCards.id, id));
      await log(tx, me, "residence_card.update", id, { renewalStatus: v.renewalStatus, stage: cardStage({ expiryDate: v.expiryDate, renewalStatus: v.renewalStatus, today }).stage, fields });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    return ok();
  });
}

/**
 * "Terima kartu baru" = SATU transaksi: kartu lama jadi `received` (+ diterima oleh staf/pekerja, tanggal serah bila staf) DAN kartu baru dibuat (tanggal habis baru, status belum mulai).
 * DB menegakkan pasangan ini (constraint trigger tertunda). Kartu lama harus sudah diajukan (punya tanggal pengajuan).
 */
export async function receiveCard(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me, today) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("cards.errors.invalid");
    let candidateId = "";
    await tenantQuery(async (tx) => {
      const card = await loadEditableCard(tx, me, id, today);
      candidateId = card.candidateId;
      if (card.renewalStatus === "received" || card.renewalStatus === "rejected") throw new ActionError("cards.errors.cannotReceive");
      const parsed = parseReceive(raw(fd), { appliedOn: card.appliedOn, expiryDate: card.expiryDate, skillFieldId: card.skillFieldId }, today);
      if (!parsed.ok) throw cardErr(parsed.error);
      const v = parsed.value;
      await assertSkillFieldUsable(tx, v.next.skillFieldId, card.skillFieldId);
      // urutan: kartu lama dulu (received), baru pengganti; pemeriksaan "wajib punya pengganti" tertunda sampai commit
      await tx.update(residenceCards).set({ renewalStatus: "received", receivedOn: v.receivedOn, receivedBy: v.receivedBy, handedOverOn: v.handedOverOn }).where(eq(residenceCards.id, id));
      const [next] = await tx.insert(residenceCards).values({
        organizationId: me.organizationId, createdBy: me.id, candidateId: card.candidateId, previousCardId: id, skillFieldId: v.next.skillFieldId, periodMonths: v.next.periodMonths, expiryDate: v.next.expiryDate, renewalStatus: "not_started",
      }).returning({ id: residenceCards.id });
      await log(tx, me, "residence_card.receive", id, { renewalStatus: "received", receivedBy: v.receivedBy, stage: "done" });
      await log(tx, me, "residence_card.create", next.id, { residenceStatus: "ssw1", renewalStatus: "not_started", stage: cardStage({ expiryDate: v.next.expiryDate, renewalStatus: "not_started", today }).stage });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    return ok("cards.received");
  });
}

/** Catat tanggal kartu yang sudah diterima STAF diserahkan ke pekerja (setelah "Terima kartu baru"). */
export async function handOverCard(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me, today) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("cards.errors.invalid");
    let candidateId = "";
    await tenantQuery(async (tx) => {
      const card = await loadEditableCard(tx, me, id, today);
      candidateId = card.candidateId;
      const parsed = parseHandover(raw(fd), { receivedOn: card.receivedOn, receivedBy: card.receivedBy }, today);
      if (!parsed.ok) throw cardErr(parsed.error);
      await tx.update(residenceCards).set({ handedOverOn: parsed.value }).where(eq(residenceCards.id, id));
      await log(tx, me, "residence_card.update", id, { renewalStatus: card.renewalStatus, receivedBy: "staff", fields: ["handedOverOn"] });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    return ok();
  });
}

/** Batalkan kartu (salah input): alasan wajib, final. Kartu yang sudah punya pengganti / pengganti dari kartu diterima ditolak DB (pesan jelas). */
export async function voidCard(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me, today) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("cards.errors.invalid");
    const reason = parseVoidReason(str(fd, "reason"));
    if (!reason.ok) throw new ActionError("cards.errors.reasonRequired");
    let candidateId = "";
    await tenantQuery(async (tx) => {
      const card = await loadEditableCard(tx, me, id, today);
      candidateId = card.candidateId;
      await tx.update(residenceCards).set({ status: "void", voidReason: reason.value }).where(eq(residenceCards.id, id));
      await log(tx, me, "residence_card.void", id, { status: "void" });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    return ok("cards.voided");
  });
}
