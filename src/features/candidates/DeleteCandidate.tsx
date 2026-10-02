"use client";

import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/FormBits";
import { btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { idle, type FormState } from "@/lib/form-state";
import { deleteCandidate } from "./delete-actions";
import { confirmationMatches, type DeleteSummary } from "./delete-shared";

/**
 * "Zona berbahaya": hapus kandidat permanen (hanya LPK_ADMIN pemilik; komponen ini TIDAK dirender untuk peran lain).
 * Dialog dalam halaman (<dialog>), bukan window.confirm: Admin harus mengetik nama kandidat persis (atau kodenya bila lebih pendek).
 * Aturan sebenarnya (peran, blokir DOCUMENT_PROCESS/DEPARTED) dijaga server action + RLS + trigger database.
 */
export function DeleteCandidate({ candidateId, name, code, summary, shared }: { candidateId: string; name: string; code: string; summary: DeleteSummary; shared: boolean }) {
  const t = useTranslations("deleteCandidate");
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(deleteCandidate, idle);
  const matches = confirmationMatches(typed, name, candidateId);
  const tskData = summary.assessmentsTsk + summary.notes + summary.selections + summary.placements;
  const rows: Array<[string, number]> = [
    ["documents", summary.documents],
    ["assessmentsLpk", summary.assessmentsLpk],
    ["assessmentsTsk", summary.assessmentsTsk],
    ["notes", summary.notes],
    ["selections", summary.selections],
    ["placements", summary.placements],
  ];

  return (
    <section className={`${cardClass} border-rose-200 p-5`} data-testid="danger-zone">
      <h2 className="font-medium text-rose-800">{t("zoneTitle")}</h2>
      <p className="mt-1 text-sm text-stone-600">{t("zoneIntro")}</p>
      <button
        type="button"
        data-testid="delete-open"
        onClick={() => {
          setTyped("");
          dialog.current?.showModal();
        }}
        className="mt-3 inline-flex items-center rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
      >
        {t("open")}
      </button>

      <dialog ref={dialog} data-testid="delete-dialog" aria-labelledby="delete-title" className="m-auto w-full max-w-lg rounded-2xl p-0 shadow-xl backdrop:bg-stone-900/50">
        <form action={action} className="space-y-4 p-6">
          <input type="hidden" name="candidateId" value={candidateId} />
          <h3 id="delete-title" className="text-lg font-semibold text-rose-800">{t("title")}</h3>
          <p className="text-sm">
            <span className="font-medium" data-testid="delete-name">{name}</span>
            <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-600" data-testid="delete-code">{code}</span>
          </p>
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900">{t("irreversible")}</p>

          <div>
            <p className="text-sm font-medium">{t("willBeDeleted")}</p>
            <ul className="mt-1 space-y-0.5 text-sm text-stone-700" data-testid="delete-summary">
              {rows.map(([key, n]) => (
                <li key={key} data-key={key} data-count={n} className="flex justify-between gap-3">
                  <span>{t(`items.${key}`)}</span>
                  <span className="tabular-nums font-medium">{n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-stone-500">{t("alsoPersonal")}</p>
          </div>

          {shared && tskData > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="delete-tsk-warning">{t("tskWarning")}</p>
          )}
          <p className="text-sm text-stone-600">{t("suggestion")}</p>

          {summary.blocked ? (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900" data-testid="delete-blocked">{t("errors.blocked")}</p>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="delete-confirm" className={labelClass}>{t("confirmLabel", { code })}</label>
              <input
                id="delete-confirm"
                name="confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className={inputClass}
                data-testid="delete-confirm-input"
              />
            </div>
          )}
          <FormAlert state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => dialog.current?.close()} data-testid="delete-cancel">{t("cancel")}</button>
            <button
              type="submit"
              disabled={!matches || pending || summary.blocked}
              data-testid="delete-submit"
              className="inline-flex items-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? t("deleting") : t("submit")}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
