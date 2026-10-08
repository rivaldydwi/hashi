// Data halaman perpanjangan online (T-021): menyusun RenewalInput dari kandidat, data pribadi (paspor, alamat Indonesia), data Jepang pekerja, dan kartu terkini.
// Semua lewat RLS TSK. TIDAK PERNAH memilih nomor kartu (`number_enc`): hanya ADA/TIDAK ada (kolom card_id), nomor lengkap lewat aksi yang diaudit.
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { currentCard } from "@/db/zairyu";
import type { RenewalInput } from "@/db/renewal";
import { candidatePrivate, candidates, clientCompanies, clientSites, placements, residenceCardSecrets, skillFields, workerJpProfiles } from "@/db/schema";
import type { CurrentUser } from "@/lib/session";
import { cardEditAccess, cardsOfWorker } from "./queries";

export type JpProfile = { addressJp: string | null; phoneJp: string | null };

export async function loadJpProfile(tx: Tx, candidateId: string): Promise<JpProfile | null> {
  const [row] = await tx.select({ addressJp: workerJpProfiles.addressJp, phoneJp: workerJpProfiles.phoneJp }).from(workerJpProfiles).where(eq(workerJpProfiles.candidateId, candidateId)).limit(1);
  return row ?? null;
}

export type RenewalData = {
  workerName: string;
  cardId: string | null;
  input: RenewalInput;
};

/** null = pekerja tidak terlihat. `canEdit` = 担当 efektif atau TSK_ADMIN (aturan halaman: selain itu 404). */
export async function loadRenewal(tx: Tx, me: Pick<CurrentUser, "id" | "role">, candidateId: string, today: string): Promise<{ canEdit: boolean; data: RenewalData | null }> {
  const access = await cardEditAccess(tx, me, candidateId, today);
  if (!access.canEdit) return { canEdit: false, data: null };
  const [c] = await tx.select({ fullName: candidates.fullName, birthDate: candidates.birthDate, gender: candidates.gender, maritalStatus: candidates.maritalStatus, fieldId: candidates.fieldId }).from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  if (!c) return { canEdit: true, data: null };
  const [priv] = await tx.select({ address: candidatePrivate.address, passportNumber: candidatePrivate.passportNumber, passportExpiry: candidatePrivate.passportExpiryDate }).from(candidatePrivate).where(eq(candidatePrivate.candidateId, candidateId)).limit(1);
  const jp = await loadJpProfile(tx, candidateId);
  const cards = await cardsOfWorker(tx, candidateId);
  const card = currentCard(cards);
  const [secret] = card ? await tx.select({ id: residenceCardSecrets.cardId }).from(residenceCardSecrets).where(eq(residenceCardSecrets.cardId, card.id)).limit(1) : [];
  const [company] = await tx
    .select({ name: clientCompanies.name })
    .from(placements)
    .innerJoin(clientSites, eq(clientSites.id, placements.siteId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .where(and(eq(placements.candidateId, candidateId), eq(placements.status, "ACTIVE")))
    .limit(1);
  const fieldId = card?.skillFieldId ?? c.fieldId;
  const [field] = fieldId ? await tx.select({ ja: skillFields.nameJa }).from(skillFields).where(eq(skillFields.id, fieldId)).limit(1) : [];
  return {
    canEdit: true,
    data: {
      workerName: c.fullName,
      cardId: card?.id ?? null,
      input: {
        fullName: c.fullName, birthDate: c.birthDate ?? null, gender: c.gender ?? null, maritalStatus: c.maritalStatus ?? null,
        homeAddress: priv?.address ?? null, addressJp: jp?.addressJp ?? null, phoneJp: jp?.phoneJp ?? null,
        passportNumber: priv?.passportNumber ?? null, passportExpiry: priv?.passportExpiry ?? null,
        card: card ? { periodMonths: card.periodMonths, expiryDate: card.expiryDate, hasNumber: !!secret } : null,
        companyName: company?.name ?? null, fieldNameJa: field?.ja ?? null, today,
      },
    },
  };
}
