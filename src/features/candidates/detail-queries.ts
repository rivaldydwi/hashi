import { and, asc, desc, eq, getTableColumns } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  candidateCertificates,
  candidateHeadlineDecision,
  clientCompanies,
  clientSites,
  jobOrders,
  placements,
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
  // TSK: baris keputusannya sendiri (umum + per job order) beserta job order, lokasi, dan perusahaannya (RLS).
  // LPK: HANYA keputusan paling maju per TSK (view candidate_headline_decision); job order dan klien tidak pernah dibaca.
  const isTsk = me.organizationType === "TSK";
  type SelectionRow = {
    id: string;
    tskOrgId: string;
    tskName: string;
    decision: (typeof candidateSelections.$inferSelect)["decision"];
    decidedAt: Date;
    jobOrderId: string | null;
    jobOrderTitle: string | null;
    siteName: string | null;
    companyName: string | null;
  };
  const selections: SelectionRow[] = isTsk
    ? await tx
        .select({
          id: candidateSelections.id,
          tskOrgId: candidateSelections.tskOrgId,
          tskName: organizations.name,
          decision: candidateSelections.decision,
          decidedAt: candidateSelections.decidedAt,
          jobOrderId: candidateSelections.jobOrderId,
          jobOrderTitle: jobOrders.title,
          siteName: clientSites.name,
          companyName: clientCompanies.name,
        })
        .from(candidateSelections)
        .innerJoin(organizations, eq(organizations.id, candidateSelections.tskOrgId))
        .leftJoin(jobOrders, eq(jobOrders.id, candidateSelections.jobOrderId))
        .leftJoin(clientSites, eq(clientSites.id, jobOrders.siteId))
        .leftJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
        .where(eq(candidateSelections.candidateId, id))
        .orderBy(asc(candidateSelections.decidedAt))
    : (
        await tx
          .select({ tskOrgId: candidateHeadlineDecision.tskOrgId, tskName: organizations.name, decision: candidateHeadlineDecision.decision, decidedAt: candidateHeadlineDecision.decidedAt })
          .from(candidateHeadlineDecision)
          .innerJoin(organizations, eq(organizations.id, candidateHeadlineDecision.tskOrgId))
          .where(eq(candidateHeadlineDecision.candidateId, id))
          .orderBy(asc(organizations.name))
      ).map((r) => ({ ...r, id: `${r.tskOrgId}`, jobOrderId: null, jobOrderTitle: null, siteName: null, companyName: null }));
  // Penempatan: hanya TSK pemilik (RLS); sisi LPK tidak membacanya
  const placementRows = isTsk
    ? await tx
        .select({
          id: placements.id,
          status: placements.status,
          startDate: placements.startDate,
          endDate: placements.endDate,
          note: placements.note,
          jobOrderId: placements.jobOrderId,
          jobOrderTitle: jobOrders.title,
          siteName: clientSites.name,
          companyName: clientCompanies.name,
        })
        .from(placements)
        .innerJoin(clientSites, eq(clientSites.id, placements.siteId))
        .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
        .leftJoin(jobOrders, eq(jobOrders.id, placements.jobOrderId))
        .where(eq(placements.candidateId, id))
        .orderBy(desc(placements.startDate))
    : [];
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

  // Keputusan paling maju milik TSK ini (dasar hak edit dan izin interview)
  const mine = isTsk
    ? ((await tx.select({ decision: candidateHeadlineDecision.decision }).from(candidateHeadlineDecision).where(and(eq(candidateHeadlineDecision.candidateId, id), eq(candidateHeadlineDecision.tskOrgId, me.organizationId))).limit(1))[0] ?? null)
    : null;
  return { candidate, full: { priv: priv ?? null, lists, documents, selections, placements: placementRows, notes, myDecision: mine?.decision ?? null } };
}

export type Detail = NonNullable<Awaited<ReturnType<typeof loadDetail>>>;

/** Baris kandidat + hak akses untuk action (memakai RLS: kandidat yang tak terlihat = tidak ada). */
export async function getCandidateForAction(tx: Tx, me: CurrentUser, id: string) {
  const [c] = await tx
    .select({ id: candidates.id, organizationId: candidates.organizationId, stage: candidates.stage, fieldId: candidates.fieldId })
    .from(candidates)
    .where(eq(candidates.id, id))
    .limit(1);
  if (!c) return null;
  let myDecision = null;
  if (me.organizationType === "TSK") {
    const [s] = await tx
      .select({ decision: candidateHeadlineDecision.decision })
      .from(candidateHeadlineDecision)
      .where(and(eq(candidateHeadlineDecision.candidateId, id), eq(candidateHeadlineDecision.tskOrgId, me.organizationId)))
      .limit(1);
    myDecision = s?.decision ?? null;
  }
  return { ...c, myDecision };
}
