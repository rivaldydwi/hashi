"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { candidateDocuments, documentType } from "@/db/schema";
import { ActionError, pgErrorCode } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery } from "@/lib/session";
import { auditChange, ok, requireEditable, run, uuid } from "@/features/candidates/guards";
import { buildSchema } from "@/features/candidates/sections";
import { DOCUMENT_FIELDS } from "./fields";
import { documentPath, extForMime, removeDocument, safeOriginalName, writeDocument } from "./storage";
import { readUpload } from "./upload";

/**
 * Unggah satu dokumen. Boleh: LPK_ADMIN (semua status) dan TSK yang syarat edit-nya terpenuhi
 * (dijaga RLS juga). File dicek dari isinya (magic bytes) dan disimpan dengan nama = id dokumen.
 */
export async function uploadDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const parsed = buildSchema(DOCUMENT_FIELDS).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { status: "error", key: "common.invalidInput" };
    const values = parsed.data as { type: (typeof documentType.enumValues)[number]; issuedDate: string | null; expiryDate: string | null };
    const upload = await readUpload(formData.get("file"));
    if ("error" in upload) return { status: "error", key: upload.error };

    const id = randomUUID();
    let written: string | null = null;
    try {
      await tenantQuery(async (tx) => {
        const { cand } = await requireEditable(tx, me, formData.get("candidateId"));
        await tx.insert(candidateDocuments).values({
          id,
          candidateId: cand.id,
          type: values.type,
          originalFilename: upload.originalName,
          mimeType: upload.mime,
          sizeBytes: upload.size,
          issuedDate: values.issuedDate,
          expiryDate: values.expiryDate,
          uploadedBy: me.id,
        });
        await auditChange(tx, me, cand, "document.upload", "candidate_document", id, "documents", ["type"]);
        // File ditulis PALING AKHIR di dalam transaksi: kalau gagal, baris dan audit ikut dibatalkan.
        written = documentPath(cand.organizationId, cand.id, id, upload.ext);
        await writeDocument(written, upload.bytes);
      });
    } catch (err) {
      if (written) await removeDocument(written).catch(() => {}); // commit gagal setelah file tertulis
      if (pgErrorCode(err) === "42501") return { status: "error", key: "detail.errors.readOnly" };
      throw err;
    }
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok("detail.documents.uploaded");
  });
}

/** Hapus dokumen: baris di database (RLS) lalu file di disk. Aturan sama dengan unggah. */
export async function deleteDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const docId = formData.get("documentId");
    if (!uuid.safeParse(docId).success) return { status: "error", key: "common.invalidInput" };
    let file: string | null = null;
    await tenantQuery(async (tx) => {
      const { cand } = await requireEditable(tx, me, formData.get("candidateId"));
      const [row] = await tx
        .delete(candidateDocuments)
        .where(and(eq(candidateDocuments.id, docId as string), eq(candidateDocuments.candidateId, cand.id)))
        .returning({ id: candidateDocuments.id, mime: candidateDocuments.mimeType });
      if (!row) throw new ActionError("detail.errors.notFound"); // tidak ada, atau RLS menolak
      await auditChange(tx, me, cand, "document.delete", "candidate_document", row.id, "documents");
      file = documentPath(cand.organizationId, cand.id, row.id, extForMime(row.mime));
    });
    if (file) await removeDocument(file).catch(() => {}); // sisa file yatim tidak bisa diakses (baris sudah hilang)
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return ok("detail.documents.deleted");
  });
}
