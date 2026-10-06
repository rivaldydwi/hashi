"use client";

import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/FormBits";
import { btnDanger, btnPrimary, btnSecondary } from "@/components/styles";
import { FieldInputs } from "@/features/candidates/DetailForms";
import { ManualForm, Submit } from "@/features/clients/ClientForms";
import { createJobOrder, deleteJobOrder, proposeCandidate, setJobOrderStatus, updateJobOrder, updatePlacement } from "./actions";
import { SheetSection } from "@/features/clients/ClientForms";
import { JOB_ORDER_FIELDS, JOB_ORDER_SHEET_FIELDS, PLACEMENT_FIELDS } from "./fields";

type Values = Record<string, string | boolean>;

export function JobOrderForm({ siteId, jobOrder, siteFieldIds }: { siteId: string; jobOrder?: { id: string; values: Values }; siteFieldIds: string[] }) {
  const t = useTranslations("jobOrders");
  const empty: Values = Object.fromEntries([...JOB_ORDER_FIELDS, ...JOB_ORDER_SHEET_FIELDS].map((f) => [f.name, f.kind === "boolean" ? false : f.name === "positions" ? "1" : f.name === "program" ? "SSW" : ""]));
  return (
    <ManualForm action={jobOrder ? updateJobOrder : createJobOrder} testid={jobOrder ? "form-job-order-edit" : "form-job-order-add"}>
      {({ state, pending }) => (
        <>
          <input type="hidden" name="siteId" value={siteId} />
          {jobOrder && <input type="hidden" name="jobOrderId" value={jobOrder.id} />}
          <FieldInputs section="jobOrder" labelNs="jobOrders.forms.jobOrder" idPrefix="jo" fields={JOB_ORDER_FIELDS} values={jobOrder?.values ?? empty} skillFieldIds={siteFieldIds} />
          <SheetSection section="jobOrder" labelNs="jobOrders.forms.jobOrder" idPrefix="jo" fields={JOB_ORDER_SHEET_FIELDS} values={jobOrder?.values ?? empty} />
          <FormAlert state={state} />
          <Submit pending={pending}>{jobOrder ? t("save") : t("create")}</Submit>
        </>
      )}
    </ManualForm>
  );
}

/** Tutup / buka lagi / tandai terisi (manual). */
export function StatusButtons({ jobOrderId, status }: { jobOrderId: string; status: "OPEN" | "FILLED" | "CLOSED" }) {
  const t = useTranslations("jobOrders");
  const next: Array<{ to: "OPEN" | "FILLED" | "CLOSED"; label: string }> = status === "OPEN" ? [{ to: "CLOSED", label: t("close") }, { to: "FILLED", label: t("markFilled") }] : [{ to: "OPEN", label: t("reopen") }];
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="status-buttons">
      {next.map((n) => (
        <ManualForm key={n.to} progressive action={setJobOrderStatus} className="inline-flex items-center gap-2" testid={`status-${n.to}`}>
          {({ state, pending }) => (
            <>
              <input type="hidden" name="jobOrderId" value={jobOrderId} />
              <input type="hidden" name="status" value={n.to} />
              <button type="submit" disabled={pending} className={btnSecondary} data-testid={`status-${n.to}-button`}>{n.label}</button>
              <FormAlert state={state} />
            </>
          )}
        </ManualForm>
      ))}
    </div>
  );
}

export function DeleteJobOrder({ jobOrderId }: { jobOrderId: string }) {
  const t = useTranslations("jobOrders");
  return (
    <details className="rounded-lg border border-rose-200 bg-rose-50/40 p-3" data-testid="delete-job-order">
      <summary className="cursor-pointer text-sm font-medium text-rose-700">{t("deletePermanent")}</summary>
      <ManualForm progressive action={deleteJobOrder} className="space-y-2 pt-2">
        {({ state, pending }) => (
          <>
            <input type="hidden" name="jobOrderId" value={jobOrderId} />
            <p className="text-sm text-rose-900">{t("deleteWarning")}</p>
            <FormAlert state={state} />
            <button type="submit" disabled={pending} className={btnDanger} data-testid="delete-job-order-confirm">{t("deleteConfirm")}</button>
          </>
        )}
      </ManualForm>
    </details>
  );
}

/** Tombol "Ajukan" per kandidat pada tab Kandidat cocok. */
export function ProposeButton({ jobOrderId, candidateId }: { jobOrderId: string; candidateId: string }) {
  const t = useTranslations("jobOrders");
  return (
    <ManualForm progressive action={proposeCandidate} className="inline-flex flex-col items-end gap-1" testid="form-propose">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="jobOrderId" value={jobOrderId} />
          <input type="hidden" name="candidateId" value={candidateId} />
          <button type="submit" disabled={pending} className={btnPrimary} data-testid="propose-button">{t("propose")}</button>
          <FormAlert state={state} />
        </>
      )}
    </ManualForm>
  );
}

/** Penempatan: tanggal mulai kerja, selesai, status, catatan. */
export function PlacementForm({ placementId, candidateId, values }: { placementId: string; candidateId: string; values: Values }) {
  const t = useTranslations("jobOrders");
  return (
    <ManualForm action={updatePlacement} testid="form-placement">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="placementId" value={placementId} />
          <input type="hidden" name="candidateId" value={candidateId} />
          <FieldInputs section="placement" labelNs="jobOrders.forms.placement" idPrefix={`pl-${placementId.slice(0, 8)}`} fields={PLACEMENT_FIELDS} values={values} />
          <FormAlert state={state} />
          <Submit pending={pending}>{t("save")}</Submit>
        </>
      )}
    </ManualForm>
  );
}
