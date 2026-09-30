import { and, asc, desc, eq, getTableColumns } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  candidateCertificates,
  candidateDocuments,
  candidateEducations,
  candidateFamilyMembers,
  candidateNotes,
  candidatePrivate,
  candidates,
  candidateSelections,
  candidateWorkHistories,
  organizations,
  users,
} from "@/db/schema";
import type { CurrentUser } from "@/lib/session";

/**
 * Semua data untuk halaman detail. Bagian yang tidak boleh dilihat peran ini TIDAK dibaca sama
 * sekali (sensei hanya mendapat data dasar), jadi tidak ada jalan data itu sampai ke HTML.
 * RLS tetap penjaga utama; ini lapisan kedua.
 */
export async function loadDetail(tx: Tx, me: CurrentUser, id: string) {
  const [candidate] = await tx
    .select({ ...getTableColumns(candidates), lpkName: organizations.name })
    .from(candidates)
    .innerJoin(organizations, eq(organizations.id, candidates.organizationId))
    .where(eq(candidates.id, id))
    .limit(1);
  if (!candidate) return null;
  if (me.role === "LPK_SENSEI") return { candidate, full: null };

  const [priv] = await tx.select().from(candidatePrivate).where(eq(candidatePrivate.candidateId, id)).limit(1);
  const lists = {
    family: await tx.select().from(candidateFamilyMembers).where(eq(candidateFamilyMembers.candidateId, id)).orderBy(asc(candidateFamilyMembers.createdAt)),
    education: await tx.select().from(candidateEducations).where(eq(candidateEducations.candidateId, id)).orderBy(desc(candidateEducations.endYear), desc(candidateEducations.startYear)),
    work: await tx.select().from(candidateWorkHistories).where(eq(candidateWorkHistories.candidateId, id)).orderBy(desc(candidateWorkHistories.startDate)),
    certificates: await tx.select().from(candidateCertificates).where(eq(candidateCertificates.candidateId, id)).orderBy(desc(candidateCertificates.issuedDate)),
  };
  // TSK melihat keputusannya sendiri (RLS); LPK melihat keputusan semua TSK mitra.
  const selections = await tx
    .select({
      id: candidateSelections.id,
      tskOrgId: candidateSelections.tskOrgId,
      tskName: organizations.name,
      decision: candidateSelections.decision,
      decidedAt: candidateSelections.decidedAt,
    })
    .from(candidateSelections)
    .innerJoin(organizations, eq(organizations.id, candidateSelections.tskOrgId))
    .where(eq(candidateSelections.candidateId, id))
    .orderBy(asc(organizations.name));
  // Catatan: RLS memilih siapa melihat apa (TSK = organisasinya; LPK_ADMIN = yang dibagikan saja).
  // Nama penulis hanya terbaca oleh rekan TSK-nya (RLS users); LPK memakai nama organisasi TSK.
  const notes = await tx
    .select({
      id: candidateNotes.id,
      body: candidateNotes.body,
      visibility: candidateNotes.visibility,
      authorId: candidateNotes.authorId,
      authorName: users.name,
      tskOrgId: candidateNotes.tskOrgId,
      tskName: organizations.name,
      createdAt: candidateNotes.createdAt,
      updatedAt: candidateNotes.updatedAt,
    })
    .from(candidateNotes)
    .innerJoin(organizations, eq(organizations.id, candidateNotes.tskOrgId))
    .leftJoin(users, eq(users.id, candidateNotes.authorId))
    .where(eq(candidateNotes.candidateId, id))
    .orderBy(desc(candidateNotes.createdAt));

  // Dokumen: hanya untuk LPK_ADMIN dan TSK (sensei tidak sampai sini). RLS juga menolak sensei.
  const documents = await tx
    .select({
      id: candidateDocuments.id,
      type: candidateDocuments.type,
      originalFilename: candidateDocuments.originalFilename,
      mimeType: candidateDocuments.mimeType,
      sizeBytes: candidateDocuments.sizeBytes,
      issuedDate: candidateDocuments.issuedDate,
      expiryDate: candidateDocuments.expiryDate,
      createdAt: candidateDocuments.createdAt,
    })
    .from(candidateDocuments)
    .where(eq(candidateDocuments.candidateId, id))
    .orderBy(desc(candidateDocuments.createdAt));

  const mine = me.organizationType === "TSK" ? (selections.find((s) => s.tskOrgId === me.organizationId) ?? null) : null;
  return { candidate, full: { priv: priv ?? null, lists, documents, selections, notes, myDecision: mine?.decision ?? null } };
}

export type Detail = NonNullable<Awaited<ReturnType<typeof loadDetail>>>;

/** Baris kandidat + hak akses untuk action (memakai RLS: kandidat yang tak terlihat = tidak ada). */
export async function getCandidateForAction(tx: Tx, me: CurrentUser, id: string) {
  const [c] = await tx
    .select({ id: candidates.id, organizationId: candidates.organizationId, stage: candidates.stage })
    .from(candidates)
    .where(eq(candidates.id, id))
    .limit(1);
  if (!c) return null;
  let myDecision = null;
  if (me.organizationType === "TSK") {
    const [s] = await tx
      .select({ decision: candidateSelections.decision })
      .from(candidateSelections)
      .where(and(eq(candidateSelections.candidateId, id), eq(candidateSelections.tskOrgId, me.organizationId)))
      .limit(1);
    myDecision = s?.decision ?? null;
  }
  return { ...c, myDecision };
}
