"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { btnDanger, inputClass, labelClass } from "@/components/styles";
import { documentType, type DocumentType } from "@/db/schema";
import { idle, type FormState } from "@/lib/form-state";
import { deleteDocument, uploadDocument } from "./actions";
import { MAX_DOCUMENT_BYTES } from "./storage-limits";

/** Cek ukuran di browser supaya pesan muncul sebelum berkas terkirim (server tetap memeriksa sendiri). */
export function checkFileSize(input: HTMLInputElement, message: string) {
  const big = (input.files?.[0]?.size ?? 0) > MAX_DOCUMENT_BYTES;
  input.setCustomValidity(big ? message : "");
  if (big) input.reportValidity();
}

export function DocumentUploadForm({ candidateId, count, defaultType }: { candidateId: string; count: number; defaultType?: DocumentType }) {
  const [state, action] = useActionState<FormState, FormData>(uploadDocument, idle);
  const t = useTranslations("detail.documents");
  return (
    <form action={action} key={count} className="space-y-4 pt-3" data-testid="form-document-upload">
      <input type="hidden" name="candidateId" value={candidateId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="doc-type" className={labelClass}>{t("type")} *</label>
          <select id="doc-type" name="type" required defaultValue={defaultType ?? "PASSPORT"} className={inputClass}>
            {documentType.enumValues.map((v) => (
              <option key={v} value={v}>{t(`types.${v}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-file" className={labelClass}>{t("file")} *</label>
          <input
            id="doc-file"
            name="file"
            type="file"
            required
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => checkFileSize(e.currentTarget, t("errors.tooBig"))}
            className={inputClass}
          />
          <p className="text-xs text-stone-500">{t("fileHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-issued" className={labelClass}>{t("issuedDate")}</label>
          <input id="doc-issued" name="issuedDate" type="date" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-expiry" className={labelClass}>{t("expiryDate")}</label>
          <input id="doc-expiry" name="expiryDate" type="date" className={inputClass} />
        </div>
      </div>
      <FormAlert state={state} />
      <SubmitButton>{t("upload")}</SubmitButton>
    </form>
  );
}

export function DocumentDeleteForm({ candidateId, documentId }: { candidateId: string; documentId: string }) {
  const [state, action] = useActionState<FormState, FormData>(deleteDocument, idle);
  const t = useTranslations("detail.documents");
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="documentId" value={documentId} />
      <SubmitButton className={`${btnDanger} !px-3 !py-1 text-xs`}>{t("delete")}</SubmitButton>
      <FormAlert state={state} />
    </form>
  );
}
