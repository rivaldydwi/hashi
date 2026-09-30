import { getFormatter, getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import type { CandidateDocument } from "@/db/schema";
import { DocumentDeleteForm, DocumentUploadForm } from "./DocumentForms";

type Doc = Pick<CandidateDocument, "id" | "type" | "originalFilename" | "mimeType" | "sizeBytes" | "issuedDate" | "expiryDate" | "createdAt">;

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Dokumen kandidat. Hanya dirender untuk LPK_ADMIN dan TSK (sensei tidak pernah mendapat bagian ini). */
export async function DocumentsSection({
  candidateId,
  docs,
  canEdit,
}: {
  candidateId: string;
  docs: Doc[];
  canEdit: boolean;
}) {
  const t = await getTranslations("detail.documents");
  const format = await getFormatter();
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className={`${cardClass} p-5`} data-testid="section-documents">
      <h2 className="font-medium">{t("title")}</h2>
      {docs.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" data-testid="document-row">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-stone-900">{t(`types.${d.type}`)}</p>
                <p className="truncate text-xs text-stone-500" data-testid="document-name">
                  {d.originalFilename} · {size(d.sizeBytes)}
                  {d.issuedDate && ` · ${t("issuedDate")}: ${day(d.issuedDate)}`}
                  {d.expiryDate && ` · ${t("expiryDate")}: ${day(d.expiryDate)}`}
                </p>
                {d.expiryDate && d.expiryDate < today && (
                  <span className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">{t("expired")}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <a href={`/candidates/${candidateId}/documents/${d.id}`} download className="text-sm font-medium text-brand-700 hover:underline" data-testid="document-download">
                  {t("download")}
                </a>
                {canEdit && <DocumentDeleteForm candidateId={candidateId} documentId={d.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <details className="mt-3 border-t border-stone-100 pt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">+ {t("upload")}</summary>
          <DocumentUploadForm candidateId={candidateId} count={docs.length} />
        </details>
      )}
    </section>
  );
}
