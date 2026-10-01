"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  candidateCertificates,
  candidateEducations,
  candidateFamilyMembers,
  candidateNotes,
  candidatePrivate,
  candidates,
  candidateSelections,
  candidateStage,
  candidateWorkHistories,
  noteVisibility,
  selectionDecision,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { requireUser, tenantQuery, type CurrentUser } from "@/lib/session";
import { noteAuditEntry } from "@/db/audit-entries";
import { auditChange, ok, requireEditable, run, uuid } from "./guards";
import { EARLIEST_BIRTH_DATE, latestAllowedDate } from "./validation";
import { getCandidateForAction } from "./detail-queries";
import { contentAccess, isTskRole } from "./permissions";
import { buildSchema, changedFields, listSection, singleSection, type FieldDef } from "./sections";

// Tabel dinamis per bagian. Nama kolom di definisi bagian = nama properti tabel Drizzle.
/* eslint-disable @typescript-eslint/no-explicit-any */
const LIST_TABLES: Record<string, any> = {
  candidate_family_members: candidateFamilyMembers,
  candidate_educations: candidateEducations,
  candidate_work_histories: candidateWorkHistories,
  candidate_certificates: candidateCertificates,
};

/** Simpan satu bagian berbaris tunggal (data dasar, kontak, paspor, kesehatan, ...). */
export async function saveSection(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const def = singleSection(String(formData.get("section")));
    if (!def) return { status: "error", key: "common.invalidInput" };
    const parsed = buildSchema(def.fields).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { status: "error", key: "common.invalidInput" };
    const values = parsed.data as Record<string, unknown>;

    await tenantQuery(async (tx) => {
      const { cand } = await requireEditable(tx, me, formData.get("candidateId"));
      let before: Record<string, unknown> | undefined;
      if (def.table === "candidates") {
        [before] = await tx.select().from(candidates).where(eq(candidates.id, cand.id));
        const done = await tx.update(candidates).set(values).where(eq(candidates.id, cand.id)).returning({ id: candidates.id });
        if (done.length !== 1) throw new ActionError("detail.errors.readOnly"); // RLS menolak diam-diam
      } else {
        [before] = await tx.select().from(candidatePrivate).where(eq(candidatePrivate.candidateId, cand.id));
        const done = await tx
          .insert(candidatePrivate)
          .values({ candidateId: cand.id, ...values })
          .onConflictDoUpdate({ target: candidatePrivate.candidateId, set: values })
          .returning({ id: candidatePrivate.candidateId });
        if (done.length !== 1) throw new ActionError("detail.errors.readOnly");
      }
      const fields = changedFields(def.fields, before, values);
      if (fields.length) await auditChange(tx, me, cand, "candidate.update", "candidate", cand.id, def.key, fields);
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok();
  });
}

/** Tambah atau ubah satu baris di bagian berbaris banyak (keluarga, pendidikan, kerja, sertifikat). */
export async function saveRow(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const def = listSection(String(formData.get("section")));
    if (!def) return { status: "error", key: "common.invalidInput" };
    const table = LIST_TABLES[def.table];
    const parsed = buildSchema(def.fields).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { status: "error", key: "common.invalidInput" };
    const values = parsed.data as Record<string, unknown>;
    const rowId = formData.get("rowId");

    await tenantQuery(async (tx) => {
      const { cand } = await requireEditable(tx, me, formData.get("candidateId"));
      if (rowId) {
        if (!uuid.safeParse(rowId).success) throw new ActionError("common.invalidInput");
        const [before] = await tx.select().from(table).where(and(eq(table.id, rowId), eq(table.candidateId, cand.id)));
        if (!before) throw new ActionError("detail.errors.notFound");
        const done = await tx.update(table).set(values).where(and(eq(table.id, rowId), eq(table.candidateId, cand.id))).returning({ id: table.id });
        if (done.length !== 1) throw new ActionError("detail.errors.readOnly");
        const fields = changedFields(def.fields, before, values);
        if (fields.length) await auditChange(tx, me, cand, "candidate.row_update", def.table, String(rowId), def.key, fields);
      } else {
        const [row] = await tx.insert(table).values({ candidateId: cand.id, ...values }).returning({ id: table.id });
        await auditChange(tx, me, cand, "candidate.row_create", def.table, row.id, def.key);
      }
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok();
  });
}

/** Hapus satu baris. Hanya LPK_ADMIN (TSK tidak pernah bisa menghapus; RLS juga menolak). */
export async function deleteRow(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const def = listSection(String(formData.get("section")));
    const rowId = formData.get("rowId");
    if (!def || !uuid.safeParse(rowId).success) return { status: "error", key: "common.invalidInput" };
    const table = LIST_TABLES[def.table];
    await tenantQuery(async (tx) => {
      const { cand, access } = await requireEditable(tx, me, formData.get("candidateId"));
      if (!access.canDelete) throw new ActionError("detail.errors.readOnly");
      const done = await tx.delete(table).where(and(eq(table.id, rowId), eq(table.candidateId, cand.id))).returning({ id: table.id });
      if (done.length !== 1) throw new ActionError("detail.errors.notFound");
      await auditChange(tx, me, cand, "candidate.row_delete", def.table, String(rowId), def.key);
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok("detail.deleted");
  });
}

/** Ubah status di LPK. HANYA LPK_ADMIN pemilik kandidat. */
export async function changeStage(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const stage = z.enum(candidateStage.enumValues).safeParse(formData.get("stage"));
    if (me.role !== "LPK_ADMIN" || !stage.success || !uuid.safeParse(formData.get("candidateId")).success) {
      return { status: "error", key: "detail.errors.readOnly" };
    }
    await tenantQuery(async (tx) => {
      const cand = await getCandidateForAction(tx, me, formData.get("candidateId") as string);
      if (!cand) throw new ActionError("detail.errors.notFound");
      if (cand.stage === stage.data) return;
      const done = await tx.update(candidates).set({ stage: stage.data }).where(eq(candidates.id, cand.id)).returning({ id: candidates.id });
      if (done.length !== 1) throw new ActionError("detail.errors.readOnly");
      await audit(tx, {
        organizationId: cand.organizationId,
        actorOrgId: me.organizationId,
        candidateId: cand.id,
        actorUserId: me.id,
        action: "candidate.change_stage",
        entity: "candidate",
        entityId: cand.id,
        before: { stage: cand.stage },
        after: { stage: stage.data },
      });
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok("detail.stageSaved");
  });
}

/**
 * Berbagi ke TSK mitra: satu-satunya gerbang visibilitas bagi TSK. Hanya LPK_ADMIN pemilik kandidat.
 * Mengaktifkan WAJIB dengan konfirmasi ("siswa sudah setuju"). Mematikan membuat TSK langsung tidak bisa
 * melihat kandidat, data, dokumen, catatan, dan keputusannya (RLS); semuanya TIDAK dihapus, dan muncul lagi
 * bila diaktifkan kembali. Audit: dari, ke, siapa (tanpa isi data). Cap waktu/pelaku diisi trigger database.
 */
export async function setSharing(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    if (me.role !== "LPK_ADMIN" || !uuid.safeParse(formData.get("candidateId")).success) {
      return { status: "error", key: "detail.errors.readOnly" };
    }
    const share = formData.get("share") === "on";
    if (share && formData.get("confirm") !== "on") return { status: "error", key: "detail.sharing.errors.confirmRequired" };

    await tenantQuery(async (tx) => {
      const [cand] = await tx
        .select({ id: candidates.id, organizationId: candidates.organizationId, before: candidates.sharedWithTsk })
        .from(candidates)
        .where(eq(candidates.id, formData.get("candidateId") as string));
      if (!cand) throw new ActionError("detail.errors.notFound");
      if (cand.before === share) return;
      const done = await tx.update(candidates).set({ sharedWithTsk: share }).where(eq(candidates.id, cand.id)).returning({ id: candidates.id });
      if (done.length !== 1) throw new ActionError("detail.errors.readOnly");
      await audit(tx, {
        organizationId: cand.organizationId,
        actorOrgId: me.organizationId,
        candidateId: cand.id,
        actorUserId: me.id,
        action: share ? "candidate.share_enable" : "candidate.share_disable",
        entity: "candidate",
        entityId: cand.id,
        before: { sharedWithTsk: cand.before },
        after: { sharedWithTsk: share },
      });
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    revalidatePath("/candidates");
    return ok(share ? "detail.sharing.enabled" : "detail.sharing.disabled");
  });
}

/** Tanggal tanda tangan formulir persetujuan: OPSIONAL, hanya catatan (tidak memengaruhi visibilitas). Kosong = dihapus. */
export async function setConsentDate(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    if (me.role !== "LPK_ADMIN" || !uuid.safeParse(formData.get("candidateId")).success) {
      return { status: "error", key: "detail.errors.readOnly" };
    }
    const raw = String(formData.get("dataConsentDate") ?? "").trim();
    let next: string | null = null;
    if (raw !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) {
        return { status: "error", key: "common.invalidInput" };
      }
      if (raw > latestAllowedDate() || raw < EARLIEST_BIRTH_DATE) return { status: "error", key: "candidates.errors.consentInFuture" };
      next = raw;
    }
    await tenantQuery(async (tx) => {
      const [cand] = await tx
        .select({ id: candidates.id, organizationId: candidates.organizationId, before: candidates.dataConsentDate })
        .from(candidates)
        .where(eq(candidates.id, formData.get("candidateId") as string));
      if (!cand) throw new ActionError("detail.errors.notFound");
      if (cand.before === next) return;
      const done = await tx.update(candidates).set({ dataConsentDate: next }).where(eq(candidates.id, cand.id)).returning({ id: candidates.id });
      if (done.length !== 1) throw new ActionError("detail.errors.readOnly");
      await audit(tx, {
        organizationId: cand.organizationId,
        actorOrgId: me.organizationId,
        candidateId: cand.id,
        actorUserId: me.id,
        action: "candidate.consent_date_change",
        entity: "candidate",
        entityId: cand.id,
        before: { dataConsentDate: cand.before },
        after: { dataConsentDate: next },
      });
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok("detail.consent.saved");
  });
}

/** Keputusan TSK atas kandidat. Hanya peran TSK; menulis baris milik organisasi TSK-nya (RLS). */
export async function setDecision(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const decision = z.enum(selectionDecision.enumValues).safeParse(formData.get("decision"));
    if (!isTskRole(me.role) || !decision.success || !uuid.safeParse(formData.get("candidateId")).success) {
      return { status: "error", key: "detail.errors.readOnly" };
    }
    await tenantQuery(async (tx) => {
      const cand = await getCandidateForAction(tx, me, formData.get("candidateId") as string);
      if (!cand) throw new ActionError("detail.errors.notFound");
      if ((cand.myDecision ?? "NONE") === decision.data) return;
      const done = await tx
        .insert(candidateSelections)
        .values({ candidateId: cand.id, tskOrgId: me.organizationId, decision: decision.data, decidedBy: me.id })
        .onConflictDoUpdate({
          target: [candidateSelections.candidateId, candidateSelections.tskOrgId],
          set: { decision: decision.data, decidedBy: me.id, decidedAt: new Date() },
        })
        .returning({ id: candidateSelections.id });
      if (done.length !== 1) throw new ActionError("detail.errors.readOnly");
      await audit(tx, {
        organizationId: cand.organizationId,
        actorOrgId: me.organizationId,
        candidateId: cand.id,
        actorUserId: me.id,
        action: "candidate.decision",
        entity: "candidate_selection",
        entityId: done[0].id,
        before: { decision: cand.myDecision ?? "NONE" },
        after: { decision: decision.data },
      });
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    revalidatePath("/candidates");
    return ok("detail.decisionSaved");
  });
}

const noteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  visibility: z.enum(noteVisibility.enumValues).default("TSK_ONLY"),
});

/** Tambah catatan TSK. Default "Hanya TSK". Penulis = user yang login (RLS memeriksanya). */
export async function addNote(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const parsed = noteSchema.safeParse({ body: formData.get("body"), visibility: formData.get("visibility") || undefined });
    if (!isTskRole(me.role) || !parsed.success || !uuid.safeParse(formData.get("candidateId")).success) {
      return { status: "error", key: parsed.success ? "detail.errors.readOnly" : "notes.errors.empty" };
    }
    await tenantQuery(async (tx) => {
      const cand = await getCandidateForAction(tx, me, formData.get("candidateId") as string);
      if (!cand) throw new ActionError("detail.errors.notFound");
      const [note] = await tx
        .insert(candidateNotes)
        .values({ candidateId: cand.id, tskOrgId: me.organizationId, authorId: me.id, body: parsed.data.body, visibility: parsed.data.visibility })
        .returning();
      await audit(tx, noteAuditEntry({ action: "note.create", note, lpkOrgId: cand.organizationId, actorUserId: me.id, to: note.visibility }));
    });
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok("notes.saved");
  });
}

/** Ubah isi dan/atau visibility catatan. RLS: hanya penulis atau TSK_ADMIN di TSK yang sama. */
export async function updateNote(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const noteId = formData.get("noteId");
    const wantsBody = formData.has("body");
    const parsed = noteSchema.safeParse({ body: wantsBody ? formData.get("body") : "x", visibility: formData.get("visibility") || undefined });
    if (!isTskRole(me.role) || !parsed.success || !uuid.safeParse(noteId).success) {
      return { status: "error", key: parsed.success ? "detail.errors.readOnly" : "notes.errors.empty" };
    }
    await tenantQuery(async (tx) => {
      const [old] = await tx.select().from(candidateNotes).where(eq(candidateNotes.id, noteId as string));
      if (!old) throw new ActionError("detail.errors.notFound");
      const cand = await getCandidateForAction(tx, me, old.candidateId);
      if (!cand) throw new ActionError("detail.errors.notFound");
      const visibilityChanged = formData.has("visibility") && parsed.data.visibility !== old.visibility;
      const bodyChanged = wantsBody && parsed.data.body !== old.body;
      if (!visibilityChanged && !bodyChanged) return;

      const done = await tx
        .update(candidateNotes)
        .set({
          ...(bodyChanged ? { body: parsed.data.body } : {}),
          ...(visibilityChanged ? { visibility: parsed.data.visibility } : {}),
          updatedAt: new Date(),
        })
        .where(eq(candidateNotes.id, old.id))
        .returning({ id: candidateNotes.id });
      if (done.length !== 1) throw new ActionError("notes.errors.notAllowed"); // RLS: bukan penulis / bukan TSK_ADMIN

      const base = { note: old, lpkOrgId: cand.organizationId, actorUserId: me.id };
      if (visibilityChanged) {
        await audit(tx, noteAuditEntry({ ...base, action: "note.visibility_change", from: old.visibility, to: parsed.data.visibility }));
      }
      if (bodyChanged) {
        await audit(tx, noteAuditEntry({ ...base, action: "note.update", from: old.visibility, to: visibilityChanged ? parsed.data.visibility : old.visibility, bodyChanged: true }));
      }
    });
    revalidatePath("/candidates", "layout");
    return ok("notes.saved");
  });
}

export type { FieldDef };
