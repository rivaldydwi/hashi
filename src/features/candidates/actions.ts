"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { candidateDocuments, candidatePrivate, candidates } from "@/db/schema";
import { documentPath, removeDocument, writeDocument } from "@/features/documents/storage";
import { readUpload } from "@/features/documents/upload";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { requireRole, tenantQuery } from "@/lib/session";
import { assertSkillFieldUsable } from "./guards";
import { buildSchema, isBlank, LIST_SECTIONS, SINGLE_SECTIONS } from "./sections";
import { LIST_TABLES } from "./tables";
import { createExtrasSchema, EARLIEST_BIRTH_DATE, latestAllowedDate } from "./validation";

const MAX_ROWS_PER_SECTION = 30;

/**
 * Tambah kandidat BESERTA semua bagiannya dalam SATU transaksi: kandidat, data sensitif, baris keluarga/
 * pendidikan/kerja/sertifikat, formulir persetujuan (opsional), dan audit. Gagal sebagian = tidak ada yang
 * tersimpan. HANYA LPK_ADMIN; organisasinya selalu organisasi user, bukan dari form.
 *
 * Semua kolom diturunkan dari sections.ts. Yang wajib hanya yang ditandai `required` di bagian satu-baris
 * (nama, jenis kelamin, tanggal lahir, bidang). Baris berulang yang kosong seluruhnya diabaikan; baris yang
 * sebagian terisi divalidasi penuh. Kesalahan dikembalikan per bagian/kolom (fieldErrors) tanpa mengosongkan isian.
 */
export async function addCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("LPK_ADMIN");
  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  const addError = (key: string, field: string) => ((fieldErrors[key] ??= []).includes(field) ? 0 : fieldErrors[key].push(field));
  let specificKey: string | null = null;

  // ---- bagian satu-baris (candidates + candidate_private) ----
  const candidateValues: Record<string, unknown> = {};
  const privateValues: Record<string, unknown> = {};
  const filledFields = new Set<string>();
  let privateFilled = false;
  for (const def of SINGLE_SECTIONS) {
    const sub = Object.fromEntries(def.fields.map((f) => [f.name, raw[f.name]]));
    const parsed = buildSchema(def.fields, def.orderedDates).safeParse(sub);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) addError(def.key, String(issue.path[0]));
      continue;
    }
    const values = parsed.data as Record<string, unknown>;
    Object.assign(def.table === "candidates" ? candidateValues : privateValues, values);
    for (const [name, v] of Object.entries(values)) {
      if (v !== null && v !== false) {
        filledFields.add(name);
        if (def.table === "candidate_private") privateFilled = true;
      }
    }
  }

  // ---- bagian berbaris banyak: nama input "<bagian>.<nomorBaris>.<kolom>" ----
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const def of LIST_SECTIONS) {
    const byRow = new Map<string, Record<string, unknown>>();
    const pattern = new RegExp(`^${def.key}\\.(\\d{1,4})\\.(\\w+)$`);
    for (const [name, value] of formData.entries()) {
      const m = pattern.exec(name);
      if (!m || typeof value !== "string") continue;
      byRow.set(m[1], { ...(byRow.get(m[1]) ?? {}), [m[2]]: value });
    }
    if (byRow.size > MAX_ROWS_PER_SECTION) return { status: "error", key: "common.invalidInput" };
    rows[def.key] = [];
    for (const [rowKey, rawRow] of [...byRow.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (isBlank(def.fields, rawRow)) continue; // baris kosong diabaikan
      const parsed = buildSchema(def.fields, def.orderedDates).safeParse(rawRow);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) addError(`${def.key}.${rowKey}`, String(issue.path[0]));
      } else {
        rows[def.key].push(parsed.data as Record<string, unknown>);
      }
    }
  }

  // ---- isian lain: tanggal formulir, berbagi, berkas formulir ----
  const latest = latestAllowedDate();
  const birth = candidateValues.birthDate as string | undefined;
  if (birth && (birth < EARLIEST_BIRTH_DATE || birth > latest)) {
    addError("basic", "birthDate");
    specificKey ??= "candidates.errors.birthDateInvalid";
  }
  const extras = createExtrasSchema.safeParse(raw);
  const extra = extras.success ? extras.data : { dataConsentDate: undefined, shareWithTsk: false, shareConfirm: false };
  if (!extras.success) addError("extras", "dataConsentDate");
  else if (extra.dataConsentDate && (extra.dataConsentDate > latest || extra.dataConsentDate < EARLIEST_BIRTH_DATE)) {
    addError("extras", "dataConsentDate");
    specificKey ??= "candidates.errors.consentInFuture";
  }
  if (extra.shareWithTsk && !extra.shareConfirm) {
    addError("extras", "shareConfirm");
    specificKey ??= "detail.sharing.errors.confirmRequired";
  }
  const rawForm = formData.get("consentForm");
  const consentForm = rawForm instanceof File && rawForm.size > 0 ? await readUpload(rawForm) : null;
  if (consentForm && "error" in consentForm) {
    addError("extras", "consentForm");
    specificKey ??= consentForm.error;
  }

  if (Object.keys(fieldErrors).length > 0) {
    // Hanya satu penyebab spesifik di luar validasi kolom -> pakai pesannya; selain itu pesan umum + penanda per kolom
    const onlySpecific = Object.keys(fieldErrors).every((k) => k === "extras" || k === "basic");
    return { status: "error", key: specificKey && onlySpecific ? specificKey : "candidates.errors.invalid", fieldErrors };
  }

  // ---- simpan semuanya dalam satu transaksi ----
  const valid = consentForm && !("error" in consentForm) ? consentForm : null;
  let writtenFile: string | null = null;
  let createdId: string;
  try {
    createdId = await tenantQuery(async (tx) => {
      await assertSkillFieldUsable(tx, (candidateValues as { fieldId?: unknown }).fieldId);
      const [row] = await tx
        .insert(candidates)
        .values({
          ...candidateValues,
          organizationId: me.organizationId,
          dataConsentDate: extra.dataConsentDate ?? null,
          sharedWithTsk: extra.shareWithTsk,
        } as typeof candidates.$inferInsert)
        .returning({ id: candidates.id, stage: candidates.stage });

      if (privateFilled) await tx.insert(candidatePrivate).values({ candidateId: row.id, ...privateValues });
      for (const def of LIST_SECTIONS) {
        if (rows[def.key].length) await tx.insert(LIST_TABLES[def.table]).values(rows[def.key].map((r) => ({ candidateId: row.id, ...r })));
      }
      let docId: string | null = null;
      if (valid) {
        docId = randomUUID();
        await tx.insert(candidateDocuments).values({
          id: docId,
          candidateId: row.id,
          type: "DATA_CONSENT_FORM",
          originalFilename: valid.originalName,
          mimeType: valid.mime,
          sizeBytes: valid.size,
          issuedDate: extra.dataConsentDate ?? null,
          uploadedBy: me.id,
        });
      }

      // Audit: HANYA nama kolom yang terisi dan jumlah baris, tidak pernah isinya
      await audit(tx, {
        organizationId: me.organizationId,
        actorUserId: me.id,
        candidateId: row.id,
        action: "candidate.create",
        entity: "candidate",
        entityId: row.id,
        after: {
          fields: [...filledFields].sort(),
          rows: Object.fromEntries(LIST_SECTIONS.map((d) => [d.key, rows[d.key].length])),
          sharedWithTsk: extra.shareWithTsk,
          consentForm: Boolean(valid),
          stage: row.stage,
        },
      });
      if (valid && docId) {
        await audit(tx, {
          organizationId: me.organizationId,
          actorUserId: me.id,
          candidateId: row.id,
          action: "document.upload",
          entity: "candidate_document",
          entityId: docId,
          after: { section: "documents", fields: ["type"] },
        });
        writtenFile = documentPath(me.organizationId, row.id, docId, valid.ext);
        await writeDocument(writtenFile, valid.bytes); // terakhir: bila gagal, SEMUANYA dibatalkan
      }
      return row.id;
    });
  } catch (err) {
    if (writtenFile) await removeDocument(writtenFile).catch(() => {});
    if (err instanceof ActionError) return { status: "error", key: err.code };
    console.error("addCandidate gagal; tidak ada data yang tersimpan:", err);
    return { status: "error", key: "candidates.errors.saveFailed" };
  }

  revalidatePath("/candidates");
  redirect(`/candidates/${createdId}?added=1`);
}
