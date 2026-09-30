"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { candidates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { requireRole, tenantQuery } from "@/lib/session";
import { randomUUID } from "node:crypto";
import { candidateDocuments } from "@/db/schema";
import { documentPath, removeDocument, writeDocument } from "@/features/documents/storage";
import { readUpload } from "@/features/documents/upload";
import { addCandidateSchema, EARLIEST_BIRTH_DATE, latestAllowedDate } from "./validation";

/** Tambah kandidat baru. HANYA LPK_ADMIN; organisasinya selalu organisasi user, bukan dari form. */
export async function addCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("LPK_ADMIN");
  const parsed = addCandidateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const input = parsed.data;

  const latest = latestAllowedDate();
  if (input.birthDate < EARLIEST_BIRTH_DATE || input.birthDate > latest) {
    return { status: "error", key: "candidates.errors.birthDateInvalid" };
  }
  if (input.dataConsentDate > latest) return { status: "error", key: "candidates.errors.consentInFuture" };

  let createdId: string;
  // Formulir persetujuan (opsional): diperiksa DULU, supaya file tidak valid tidak meninggalkan kandidat setengah jadi
  const rawForm = formData.get("consentForm");
  const consentForm = rawForm instanceof File && rawForm.size > 0 ? await readUpload(rawForm) : null;
  if (consentForm && "error" in consentForm) return { status: "error", key: consentForm.error };

  let writtenFile: string | null = null;
  try {
    createdId = await tenantQuery(async (tx) => {
      const [row] = await tx
        .insert(candidates)
        .values({
          organizationId: me.organizationId,
          fullName: input.fullName,
          gender: input.gender,
          birthDate: input.birthDate,
          field: input.field,
          dataConsentDate: input.dataConsentDate,
        })
        .returning({ id: candidates.id, stage: candidates.stage });

      await audit(tx, {
        organizationId: me.organizationId,
        actorUserId: me.id,
        candidateId: row.id,
        action: "candidate.create",
        entity: "candidate",
        entityId: row.id,
        after: {
          fullName: input.fullName,
          gender: input.gender,
          birthDate: input.birthDate,
          field: input.field,
          dataConsentDate: input.dataConsentDate,
          stage: row.stage,
        },
      });
      if (consentForm) {
        const docId = randomUUID();
        await tx.insert(candidateDocuments).values({
          id: docId,
          candidateId: row.id,
          type: "DATA_CONSENT_FORM",
          originalFilename: consentForm.originalName,
          mimeType: consentForm.mime,
          sizeBytes: consentForm.size,
          issuedDate: input.dataConsentDate,
          uploadedBy: me.id,
        });
        await audit(tx, {
          organizationId: me.organizationId,
          actorUserId: me.id,
          candidateId: row.id,
          action: "document.upload",
          entity: "candidate_document",
          entityId: docId,
          after: { section: "documents", fields: ["type"] },
        });
        writtenFile = documentPath(me.organizationId, row.id, docId, consentForm.ext);
        await writeDocument(writtenFile, consentForm.bytes); // terakhir: bila gagal, semuanya dibatalkan
      }
      return row.id;
    });
  } catch (err) {
    if (writtenFile) await removeDocument(writtenFile).catch(() => {});
    if (err instanceof ActionError) return { status: "error", key: err.code };
    throw err;
  }

  revalidatePath("/candidates");
  redirect(`/candidates/${createdId}?added=1`);
}
