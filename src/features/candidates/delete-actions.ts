"use server";

import { rmdir } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { candidateDocuments, candidates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode, PG_CHECK_VIOLATION } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery } from "@/lib/session";
import { documentPath, extForMime, removeDocument } from "@/features/documents/storage";
import { run, uuid } from "./guards";
import { candidateCode, confirmationMatches, type DeleteSummary } from "./delete-shared";

/** Ringkasan data yang ikut terhapus (fungsi DB sempit; hanya LPK_ADMIN pemilik, selain itu null). */
export async function loadDeleteSummary(tx: Tx, candidateId: string): Promise<DeleteSummary | null> {
  const res = await tx.execute(sql`select candidate_delete_summary(${candidateId}::uuid) as s`);
  return (res.rows[0]?.s as DeleteSummary | null) ?? null;
}

/**
 * Hapus kandidat PERMANEN. Hanya LPK_ADMIN pemilik (diperiksa di sini, dan ditegakkan RLS + trigger di database).
 * Urutan: validasi + konfirmasi nama -> satu transaksi (audit lalu DELETE; semua data turunan ikut lewat FK cascade) ->
 * SETELAH commit hapus berkas dokumen (kegagalan tidak membatalkan DB; dicatat di log dan audit `filesFailed`).
 * Audit hanya memuat id teknis, kode, dan jumlah baris; TIDAK PERNAH nama atau isi data.
 */
export async function deleteCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async (me) => {
    const candidateId = formData.get("candidateId");
    if (me.role !== "LPK_ADMIN" || !uuid.safeParse(candidateId).success) return { status: "error", key: "detail.errors.readOnly" };
    const id = candidateId as string;
    const typed = typeof formData.get("confirm") === "string" ? (formData.get("confirm") as string) : "";

    let files: string[] = [];
    let orgId = "";
    try {
      await tenantQuery(async (tx) => {
        const [cand] = await tx.select({ id: candidates.id, organizationId: candidates.organizationId, fullName: candidates.fullName }).from(candidates).where(eq(candidates.id, id)).limit(1);
        if (!cand || cand.organizationId !== me.organizationId) throw new ActionError("detail.errors.notFound");
        const summary = await loadDeleteSummary(tx, id);
        if (!summary) throw new ActionError("detail.errors.notFound");
        if (summary.blocked) throw new ActionError("deleteCandidate.errors.blocked"); // diperiksa dulu: tidak ada yang perlu diketik
        if (!confirmationMatches(typed, cand.fullName, cand.id)) throw new ActionError("deleteCandidate.errors.confirmMismatch");

        // Daftar berkas SEBELUM transaksi selesai (barisnya hilang setelah cascade)
        const docs = await tx.select({ id: candidateDocuments.id, mimeType: candidateDocuments.mimeType }).from(candidateDocuments).where(eq(candidateDocuments.candidateId, id));
        files = docs.map((d) => documentPath(cand.organizationId, cand.id, d.id, extForMime(d.mimeType)));
        orgId = cand.organizationId;

        const { blocked: _blocked, ...counts } = summary;
        void _blocked;
        await audit(tx, {
          organizationId: cand.organizationId,
          actorOrgId: me.organizationId,
          candidateId: cand.id,
          actorUserId: me.id,
          action: "candidate.delete",
          entity: "candidate",
          entityId: cand.id,
          after: { code: candidateCode(cand.id), deleted: counts, filesTotal: files.length },
        });
        const gone = await tx.delete(candidates).where(eq(candidates.id, id)).returning({ id: candidates.id });
        if (gone.length !== 1) throw new ActionError("detail.errors.notFound"); // RLS: bukan LPK_ADMIN pemilik
      });
    } catch (err) {
      // Trigger database menolak (keputusan DOCUMENT_PROCESS / DEPARTED): jalur yang tidak bisa dilewati
      if (pgErrorCode(err) === PG_CHECK_VIOLATION && /tidak bisa dihapus/.test(String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message))) {
        return { status: "error", key: "deleteCandidate.errors.blocked" };
      }
      throw err;
    }

    // ---- Setelah commit: berkas di disk
    let filesFailed = 0;
    for (const f of files) {
      try {
        await removeDocument(f);
      } catch (err) {
        filesFailed++;
        console.error(`[candidate.delete] gagal menghapus berkas ${path.basename(f)}:`, err);
      }
    }
    if (files.length > 0) {
      try {
        await rmdir(path.dirname(files[0])); // hanya bila folder kandidat sudah kosong
      } catch {
        /* tidak kosong / sudah tidak ada: tidak masalah */
      }
    }
    if (filesFailed > 0) {
      await tenantQuery((tx) =>
        audit(tx, { organizationId: orgId, actorOrgId: me.organizationId, candidateId: id, actorUserId: me.id, action: "candidate.delete_files_failed", entity: "candidate", entityId: id, after: { filesFailed, filesTotal: files.length } }),
      );
    }

    revalidatePath("/candidates");
    revalidatePath("/");
    revalidatePath("/assessments/pending");
    redirect("/candidates?deleted=1");
  });
}
