"use client";

import { startTransition, useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/FormBits";
import { btnDanger, btnPrimary, btnSecondary, inputClass, labelClass } from "@/components/styles";
import { FieldInputs } from "@/features/candidates/DetailForms";
import { useSkillFieldOptions } from "@/features/skill-fields/SkillFieldsProvider";
import { idle, type FormState } from "@/lib/form-state";
import { createCompany, createSite, deleteCompany, deleteContact, deleteSite, saveContact, setCompanyActive, setContactActive, setSiteActive, updateCompany, updateSite } from "./actions";
import { COMPANY_FIELDS, CONTACT_FIELDS, SITE_FIELDS } from "./fields";

type Values = Record<string, string | boolean>;
type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Form yang dikirim lewat onSubmit manual: isian TIDAK hilang saat error (React mengosongkan form-action yang gagal). */
export function ManualForm({ action, children, testid, className = "space-y-4", progressive = false }: { action: Action; children: (s: { state: FormState; pending: boolean }) => React.ReactNode; testid?: string; className?: string; progressive?: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, idle);
  // progressive: form hanya berisi input tersembunyi (tombol aktif/hapus), jadi memakai atribut `action` biasa
  if (progressive) {
    return (
      <form action={formAction} className={className} data-testid={testid}>
        {children({ state, pending })}
      </form>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={className}
      data-testid={testid}
    >
      {children({ state, pending })}
    </form>
  );
}

export function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  const t = useTranslations("common");
  return (
    <button type="submit" disabled={pending} className={btnPrimary} data-testid="client-submit">
      {pending ? t("saving") : children}
    </button>
  );
}

export function CompanyForm({ company }: { company?: { id: string; values: Values } }) {
  const t = useTranslations("clients");
  const empty = Object.fromEntries(COMPANY_FIELDS.map((f) => [f.name, ""]));
  return (
    <ManualForm action={company ? updateCompany : createCompany} testid={company ? "form-company-edit" : "form-company-add"}>
      {({ state, pending }) => (
        <>
          {company && <input type="hidden" name="companyId" value={company.id} />}
          <FieldInputs section="company" labelNs="clients.forms.company" idPrefix="company" fields={COMPANY_FIELDS} values={company?.values ?? empty} />
          <FormAlert state={state} />
          <Submit pending={pending}>{company ? t("save") : t("addCompany")}</Submit>
        </>
      )}
    </ManualForm>
  );
}

/** Lokasi: kolom dasar + daftar bidang kerja yang diterima (centang). */
export function SiteForm({ companyId, site }: { companyId: string; site?: { id: string; values: Values; fieldIds: string[] } }) {
  const t = useTranslations("clients");
  const options = useSkillFieldOptions();
  const empty = Object.fromEntries(SITE_FIELDS.map((f) => [f.name, ""]));
  return (
    <ManualForm action={site ? updateSite : createSite} testid={site ? "form-site-edit" : "form-site-add"}>
      {({ state, pending }) => (
        <>
          <input type="hidden" name="companyId" value={companyId} />
          {site && <input type="hidden" name="siteId" value={site.id} />}
          <FieldInputs section="site" labelNs="clients.forms.site" idPrefix="site" fields={SITE_FIELDS} values={site?.values ?? empty} />
          <fieldset className="space-y-1.5" data-testid="site-fields">
            <legend className={labelClass}>{t("acceptedFields")}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {options
                .filter((o) => o.active || site?.fieldIds.includes(o.id))
                .map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="fieldIds" value={o.id} data-code={o.code} defaultChecked={site?.fieldIds.includes(o.id)} className="h-4 w-4 rounded border-stone-300" />
                    {o.label}
                    {!o.active && <span className="text-xs text-stone-500">({t("inactive")})</span>}
                  </label>
                ))}
            </div>
            <p className="text-xs text-stone-500">{t("acceptedFieldsHint")}</p>
          </fieldset>
          <FormAlert state={state} />
          <Submit pending={pending}>{site ? t("save") : t("addSite")}</Submit>
        </>
      )}
    </ManualForm>
  );
}

export function ContactForm({ companyId, siteId, contact }: { companyId: string; siteId: string; contact?: { id: string; values: Values } }) {
  const t = useTranslations("clients");
  const empty = Object.fromEntries(CONTACT_FIELDS.map((f) => [f.name, ""]));
  return (
    <ManualForm action={saveContact} testid={contact ? "form-contact-edit" : "form-contact-add"}>
      {({ state, pending }) => (
        <>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="siteId" value={siteId} />
          {contact && <input type="hidden" name="contactId" value={contact.id} />}
          <FieldInputs section="contact" labelNs="clients.forms.contact" idPrefix={contact ? `contact-${contact.id.slice(0, 8)}` : "contact"} fields={CONTACT_FIELDS} values={contact?.values ?? empty} />
          <FormAlert state={state} />
          <Submit pending={pending}>{contact ? t("save") : t("addContact")}</Submit>
        </>
      )}
    </ManualForm>
  );
}

/** Tombol aktifkan / nonaktifkan. `kind` memilih action server yang dipanggil. */
export function ActiveToggle({ kind, hidden, active }: { kind: "company" | "site" | "contact"; hidden: Record<string, string>; active: boolean }) {
  const t = useTranslations("clients");
  const action: Action = kind === "company" ? setCompanyActive : kind === "site" ? setSiteActive : setContactActive;
  return (
    <ManualForm progressive action={action} className="inline-flex flex-wrap items-center gap-2" testid={`toggle-${kind}`}>
      {({ state, pending }) => (
        <>
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <button type="submit" disabled={pending} className={btnSecondary} data-testid={`toggle-${kind}-button`}>{active ? t("deactivate") : t("activate")}</button>
          <FormAlert state={state} />
        </>
      )}
    </ManualForm>
  );
}

/** Hapus permanen (hanya dirender untuk TSK_ADMIN): dua langkah dengan peringatan. */
export function DeleteButton({ kind, hidden, warning }: { kind: "company" | "site" | "contact"; hidden: Record<string, string>; warning: string }) {
  const t = useTranslations("clients");
  const action: Action = kind === "company" ? deleteCompany : kind === "site" ? deleteSite : deleteContact;
  return (
    <details className="rounded-lg border border-rose-200 bg-rose-50/40 p-3" data-testid={`delete-${kind}`}>
      <summary className="cursor-pointer text-sm font-medium text-rose-700">{t("deletePermanent")}</summary>
      <ManualForm progressive action={action} className="space-y-2 pt-2">
        {({ state, pending }) => (
          <>
            {Object.entries(hidden).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <p className="text-sm text-rose-900">{warning}</p>
            <FormAlert state={state} />
            <button type="submit" disabled={pending} className={btnDanger} data-testid={`delete-${kind}-confirm`}>{t("deleteConfirm")}</button>
          </>
        )}
      </ManualForm>
    </details>
  );
}

export { inputClass };
