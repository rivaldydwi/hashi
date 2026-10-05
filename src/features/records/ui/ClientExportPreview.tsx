"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { btnPrimary, cardClass } from "@/components/styles";

export type PreviewRow = { when: string; event: string; subjectStatement: string; companyResponse: string; note: string };

/**
 * Pratinjau 時系列 versi klien. Kolom 備考 tampil bawaan (boleh dimatikan sebelum unduh). Tombol unduh NONAKTIF sampai pemeriksa mencentang
 * konfirmasi; tautan unduh membawa confirm=1 (server menolak versi klien tanpa itu).
 */
export function ClientExportPreview({ caseId, rows, excluded, title, subjects }: { caseId: string; rows: PreviewRow[]; excluded: number; title: string; subjects: string }) {
  const t = useTranslations("records");
  const [notes, setNotes] = useState(true);
  const [ok, setOk] = useState(false);
  const href = `/records/export/case/${caseId}?mode=client&confirm=1&notes=${notes ? 1 : 0}`;
  const th = "px-3 py-2 text-left text-xs font-semibold text-ink-2";
  const td = "px-3 py-3 align-top text-sm";
  return (
    <div className="space-y-4" data-testid="client-preview">
      <div className={`${cardClass} p-4`}>
        <p className="text-sm text-ink-2">{t("export.clientIntro")}</p>
        <p lang="ja" className="mt-2 text-[15px] font-semibold">{title}</p>
        <p lang="ja" className="text-sm text-ink-2">{subjects}</p>
        {excluded > 0 && <p className="mt-2 text-sm text-ink-2" data-testid="excluded-note">{t("export.excluded", { n: excluded })}</p>}
      </div>
      <div className={`${cardClass} relative overflow-x-auto`}>
        <table className="w-full min-w-[40rem] border-collapse" data-testid="preview-table">
          <thead className="border-b border-line bg-page"><tr>
            <th className={th}>{t("f.tl_when")}</th><th className={th}>{t("f.tl_event")}</th><th className={th}>{t("f.tl_subjectStatement")}</th><th className={th}>{t("f.tl_companyResponse")}</th>
            {notes && <th className={th} data-testid="preview-note-col">{t("f.tl_note")}</th>}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} data-testid="preview-row">
                <td className={`${td} whitespace-nowrap`}>{r.when}</td>
                <td className={td} lang="ja"><span className="whitespace-pre-wrap break-words">{r.event}</span></td>
                <td className={td} lang="ja"><span className="whitespace-pre-wrap break-words">{r.subjectStatement || "—"}</span></td>
                <td className={td} lang="ja"><span className="whitespace-pre-wrap break-words">{r.companyResponse || "—"}</span></td>
                {notes && <td className={td} lang="ja"><span className="whitespace-pre-wrap break-words">{r.note || "—"}</span></td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-sm text-ink-2">{t("export.noRows")}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={`${cardClass} space-y-3 p-4`}>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} className="mt-0.5 h-5 w-5" data-testid="include-notes" />{t("export.includeNotes")}</label>
        <label className="flex min-h-11 items-start gap-3 text-sm font-medium"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5 h-5 w-5" data-testid="confirm-check" />{t("export.confirmText")}</label>
        {ok ? (
          <a href={href} className={btnPrimary} data-testid="download-client" download>{t("export.download")}</a>
        ) : (
          <button type="button" disabled aria-disabled="true" className={btnPrimary} data-testid="download-client-disabled">{t("export.download")}</button>
        )}
        {!ok && <p className="text-xs text-ink-2">{t("export.confirmRequired")}</p>}
      </div>
    </div>
  );
}
