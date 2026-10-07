"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { inputClass, labelClass } from "@/components/styles";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { PERIOD_OPTIONS } from "@/db/zairyu";
import { EDITABLE_STATUSES } from "../input";
import { createCard, handOverCard, receiveCard, updateCard, voidCard } from "../actions";

// Form kartu izin tinggal 在留カード (T-018). Semua input tak terkendali (nama sama dengan `input.ts`); state klien hanya untuk menampilkan tanggal yang diwajibkan status.

export type FieldOption = { id: string; label: string; active?: boolean };
type Common = { today: string; fields: FieldOption[] };

const area = `${inputClass} min-h-16 py-2`;

function PeriodSelect({ id, name, value }: { id: string; name: string; value: number | null }) {
  const t = useTranslations("cards");
  return (
    <select id={id} name={name} defaultValue={value === null ? "" : String(value)} className={inputClass} data-testid={id}>
      <option value="">{t("periodNone")}</option>
      {PERIOD_OPTIONS.map((m) => <option key={m} value={m}>{t("periodMonths", { n: m })}</option>)}
    </select>
  );
}

function FieldSelect({ id, name, value, fields }: { id: string; name: string; value: string; fields: FieldOption[] }) {
  return (
    <select id={id} name={name} defaultValue={value} className={inputClass} data-testid={id}>
      {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
    </select>
  );
}

const F = ({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) => (
  <div className="space-y-1.5"><label htmlFor={id} className={labelClass}>{label}</label>{children}{hint && <p className="text-xs text-ink-2">{hint}</p>}</div>
);

/** Kartu PERTAMA pekerja (belum ada kartu aktif). */
export function CreateCardForm({ candidateId, defaultFieldId, fields }: Omit<Common, "today"> & { candidateId: string; defaultFieldId: string }) {
  const t = useTranslations("cards");
  return (
    <ActionForm action={createCard} hidden={{ candidateId }} submitLabel={t("form.create")} className="space-y-4" testId="card-create-form">
      <div className="grid gap-4 sm:grid-cols-3">
        <F id="c-field" label={t("form.skillField")}><FieldSelect id="c-field" name="skillFieldId" value={defaultFieldId} fields={fields} /></F>
        <F id="c-period" label={t("form.period")}><PeriodSelect id="c-period" name="periodMonths" value={null} /></F>
        <F id="c-expiry" label={t("form.expiry")} hint={t("form.expiryHint")}><input id="c-expiry" name="expiryDate" type="date" min="2020-01-01" required className={inputClass} data-testid="c-expiry" /></F>
      </div>
      <F id="c-note" label={t("form.note")} hint={t("form.noteHint")}><textarea id="c-note" name="note" rows={2} maxLength={2000} lang="ja" className={area} /></F>
    </ActionForm>
  );
}

export type CardEditable = {
  id: string; skillFieldId: string; periodMonths: number | null; expiryDate: string; renewalStatus: string;
  appliedOn: string | null; additionalDocsOn: string | null; rejectedOn: string | null; note: string | null;
};

/** Ubah data + status proses; tanggal yang diwajibkan status muncul menurut pilihan (diajukan/追加資料/不許可). */
export function UpdateCardForm({ card, today, fields }: Common & { card: CardEditable }) {
  const t = useTranslations("cards");
  const [status, setStatus] = useState(card.renewalStatus);
  const needsApplied = ["applied", "additional_docs", "rejected"].includes(status);
  return (
    <ActionForm action={updateCard} hidden={{ id: card.id }} submitLabel={t("form.save")} className="space-y-4" testId="card-update-form">
      <div className="grid gap-4 sm:grid-cols-3">
        <F id="u-field" label={t("form.skillField")}><FieldSelect id="u-field" name="skillFieldId" value={card.skillFieldId} fields={fields} /></F>
        <F id="u-period" label={t("form.period")}><PeriodSelect id="u-period" name="periodMonths" value={card.periodMonths} /></F>
        <F id="u-expiry" label={t("form.expiry")}><input id="u-expiry" name="expiryDate" type="date" min="2020-01-01" defaultValue={card.expiryDate} required className={inputClass} data-testid="u-expiry" /></F>
      </div>
      <F id="u-status" label={t("form.status")}>
        <select id="u-status" name="renewalStatus" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass} data-testid="u-status">
          {EDITABLE_STATUSES.map((s) => <option key={s} value={s}>{t(`renewal.${s}`)}</option>)}
        </select>
      </F>
      <div className="grid gap-4 sm:grid-cols-3">
        {needsApplied && <F id="u-applied" label={t("form.appliedOn")}><input id="u-applied" name="appliedOn" type="date" max={today} defaultValue={card.appliedOn ?? ""} required className={inputClass} data-testid="u-applied" /></F>}
        {status === "additional_docs" && <F id="u-docs" label={t("form.additionalDocsOn")}><input id="u-docs" name="additionalDocsOn" type="date" max={today} defaultValue={card.additionalDocsOn ?? ""} required className={inputClass} data-testid="u-docs" /></F>}
        {status === "rejected" && <F id="u-rejected" label={t("form.rejectedOn")}><input id="u-rejected" name="rejectedOn" type="date" max={today} defaultValue={card.rejectedOn ?? ""} required className={inputClass} data-testid="u-rejected" /></F>}
      </div>
      <F id="u-note" label={t("form.note")} hint={t("form.noteHint")}><textarea id="u-note" name="note" rows={2} maxLength={2000} defaultValue={card.note ?? ""} lang="ja" className={area} data-testid="u-note" /></F>
    </ActionForm>
  );
}

/** "Terima kartu baru": kartu lama jadi diterima DAN kartu baru dibuat dalam satu transaksi. */
export function ReceiveCardForm({ card, today, fields }: Common & { card: Pick<CardEditable, "id" | "skillFieldId" | "periodMonths" | "expiryDate"> }) {
  const t = useTranslations("cards");
  const [by, setBy] = useState("staff");
  return (
    <ActionForm action={receiveCard} hidden={{ id: card.id }} submitLabel={t("form.receiveSubmit")} className="space-y-4" testId="card-receive-form">
      <p className="text-sm text-ink-2">{t("form.receiveHint")}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <F id="r-on" label={t("form.receivedOn")}><input id="r-on" name="receivedOn" type="date" max={today} required className={inputClass} data-testid="r-on" /></F>
        <F id="r-by" label={t("form.receivedBy")}>
          <select id="r-by" name="receivedBy" value={by} onChange={(e) => setBy(e.target.value)} className={inputClass} data-testid="r-by">
            <option value="staff">{t("receivedBy.staff")}</option>
            <option value="worker">{t("receivedBy.worker")}</option>
          </select>
        </F>
        {by === "staff" && <F id="r-hand" label={t("form.handedOverOn")} hint={t("form.handedOverHint")}><input id="r-hand" name="handedOverOn" type="date" max={today} className={inputClass} data-testid="r-hand" /></F>}
      </div>
      <fieldset className="space-y-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-semibold">{t("form.newCard")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <F id="r-expiry" label={t("form.newExpiry")}><input id="r-expiry" name="newExpiryDate" type="date" min={card.expiryDate} required className={inputClass} data-testid="r-expiry" /></F>
          <F id="r-period" label={t("form.period")}><PeriodSelect id="r-period" name="newPeriodMonths" value={card.periodMonths} /></F>
          <F id="r-field" label={t("form.skillField")}><FieldSelect id="r-field" name="newSkillFieldId" value={card.skillFieldId} fields={fields} /></F>
        </div>
      </fieldset>
    </ActionForm>
  );
}

/** Tanggal kartu yang diterima STAF diserahkan ke pekerja. */
export function HandOverForm({ id, today, receivedOn }: { id: string; today: string; receivedOn: string }) {
  const t = useTranslations("cards");
  return (
    <ActionForm action={handOverCard} hidden={{ id }} submitLabel={t("form.handOverSubmit")} submitTone="secondary" className="flex flex-wrap items-end gap-2" testId="card-handover-form">
      <F id={`h-${id}`} label={t("form.handedOverOn")}><input id={`h-${id}`} name="handedOverOn" type="date" min={receivedOn} max={today} required className={inputClass} data-testid="h-on" /></F>
    </ActionForm>
  );
}

export function VoidCardForm({ id }: { id: string }) {
  const t = useTranslations("cards");
  return (
    <ActionForm action={voidCard} hidden={{ id }} submitLabel={t("form.voidSubmit")} submitTone="danger" className="space-y-2" testId="card-void-form">
      <p className="text-sm text-rose-900">{t("form.voidWarning")}</p>
      <F id={`v-${id}`} label={`${t("form.voidReason")} *`}><textarea id={`v-${id}`} name="reason" required rows={2} maxLength={1000} lang="ja" className={area} data-testid="v-reason" /></F>
    </ActionForm>
  );
}
