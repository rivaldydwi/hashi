"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert, SubmitButton } from "@/components/FormBits";
import { btnDanger, btnSecondary, inputClass, labelClass } from "@/components/styles";
import { candidateStage, selectionDecision, type CandidateStage, type SelectionDecision } from "@/db/schema";
import { idle, type FormState } from "@/lib/form-state";
import { addNote, changeStage, deleteRow, saveRow, saveSection, setDecision, updateNote } from "./detail-actions";
import type { FieldDef } from "./sections";

type Values = Record<string, string | boolean>;

/** Kolom-kolom form, digambar dari definisi bagian. Label & pilihan diambil dari messages (detail.sections.*). */
function FieldInputs({ section, fields, values }: { section: string; fields: FieldDef[]; values: Values }) {
  const t = useTranslations(`detail.sections.${section}`);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `${section}-${f.name}`;
        const wide = f.kind === "textarea";
        return (
          <div key={f.name} className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
            {f.kind === "boolean" ? (
              <label className="flex items-center gap-2 text-sm text-stone-800">
                <input type="checkbox" id={id} name={f.name} defaultChecked={values[f.name] === true} className="h-4 w-4 rounded border-stone-300" />
                {t(`fields.${f.name}`)}
              </label>
            ) : (
              <>
                <label htmlFor={id} className={labelClass}>{t(`fields.${f.name}`)}{f.required && " *"}</label>
                {f.kind === "textarea" ? (
                  <textarea id={id} name={f.name} rows={3} required={f.required} maxLength={f.max ?? 2000} defaultValue={String(values[f.name] ?? "")} className={inputClass} />
                ) : f.kind === "select" ? (
                  <select id={id} name={f.name} required={f.required} defaultValue={String(values[f.name] ?? "")} className={inputClass}>
                    <option value="">—</option>
                    {f.options!.map((o) => (
                      <option key={o} value={o}>{t(`options.${f.name}.${o}`)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    name={f.name}
                    type={f.kind === "date" ? "date" : f.kind === "int" ? "number" : f.kind === "email" ? "email" : "text"}
                    required={f.required}
                    min={f.kind === "int" ? f.min : undefined}
                    max={f.kind === "int" ? f.max : undefined}
                    maxLength={f.kind === "text" || f.kind === "email" ? (f.max ?? 200) : undefined}
                    defaultValue={String(values[f.name] ?? "")}
                    className={inputClass}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SectionForm({ candidateId, section, fields, values }: { candidateId: string; section: string; fields: FieldDef[]; values: Values }) {
  const [state, action] = useActionState<FormState, FormData>(saveSection, idle);
  const t = useTranslations("detail");
  return (
    <form action={action} key={JSON.stringify(values)} className="space-y-4 pt-3" data-testid={`form-${section}`}>
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="section" value={section} />
      <FieldInputs section={section} fields={fields} values={values} />
      <FormAlert state={state} />
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function RowForm({
  candidateId,
  section,
  fields,
  values,
  rowId,
  canDelete,
}: {
  candidateId: string;
  section: string;
  fields: FieldDef[];
  values: Values;
  rowId?: string;
  canDelete?: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveRow, idle);
  const [delState, delAction] = useActionState<FormState, FormData>(deleteRow, idle);
  const t = useTranslations("detail");
  return (
    <div className="space-y-3 pt-3">
      <form action={action} className="space-y-4" data-testid={`form-${section}${rowId ? "-edit" : "-add"}`}>
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="section" value={section} />
        {rowId && <input type="hidden" name="rowId" value={rowId} />}
        <FieldInputs section={section} fields={fields} values={values} />
        <FormAlert state={state} />
        <SubmitButton>{rowId ? t("save") : t("addRow")}</SubmitButton>
      </form>
      {rowId && canDelete && (
        <form action={delAction}>
          <input type="hidden" name="candidateId" value={candidateId} />
          <input type="hidden" name="section" value={section} />
          <input type="hidden" name="rowId" value={rowId} />
          <FormAlert state={delState} />
          <SubmitButton className={btnDanger}>{t("delete")}</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function StageForm({ candidateId, stage }: { candidateId: string; stage: CandidateStage }) {
  const [state, action] = useActionState<FormState, FormData>(changeStage, idle);
  const t = useTranslations();
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" data-testid="form-stage">
      <input type="hidden" name="candidateId" value={candidateId} />
      <div className="space-y-1.5">
        <label htmlFor="stage" className={labelClass}>{t("detail.stageLabel")}</label>
        <select id="stage" name="stage" defaultValue={stage} className={inputClass}>
          {candidateStage.enumValues.map((s) => (
            <option key={s} value={s}>{t(`stages.${s}`)}</option>
          ))}
        </select>
      </div>
      <SubmitButton className={btnSecondary}>{t("detail.save")}</SubmitButton>
      <FormAlert state={state} />
    </form>
  );
}

export function DecisionForm({ candidateId, decision }: { candidateId: string; decision: SelectionDecision }) {
  const [state, action] = useActionState<FormState, FormData>(setDecision, idle);
  const t = useTranslations();
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" data-testid="form-decision">
      <input type="hidden" name="candidateId" value={candidateId} />
      <div className="space-y-1.5">
        <label htmlFor="decision" className={labelClass}>{t("detail.decisionLabel")}</label>
        <select id="decision" name="decision" defaultValue={decision} className={inputClass}>
          {selectionDecision.enumValues.map((d) => (
            <option key={d} value={d}>{t(`decisions.${d}`)}</option>
          ))}
        </select>
      </div>
      <SubmitButton>{t("detail.saveDecision")}</SubmitButton>
      <FormAlert state={state} />
    </form>
  );
}

export function NoteAddForm({ candidateId }: { candidateId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addNote, idle);
  const t = useTranslations("notes");
  return (
    <form action={action} key={state.status === "success" ? "done" : "new"} className="space-y-3" data-testid="form-note-add">
      <input type="hidden" name="candidateId" value={candidateId} />
      <div className="space-y-1.5">
        <label htmlFor="note-body" className={labelClass}>{t("body")}</label>
        <textarea id="note-body" name="body" rows={3} required maxLength={4000} className={inputClass} />
      </div>
      <fieldset className="space-y-1">
        <legend className={labelClass}>{t("visibility")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="visibility" value="TSK_ONLY" defaultChecked /> {t("tskOnly")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="visibility" value="SHARED_WITH_LPK" /> {t("shared")}
        </label>
        <p className="text-xs text-amber-800">{t("shareWarning")}</p>
      </fieldset>
      <FormAlert state={state} />
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

/** Ubah visibility (tombol) dan isi (form terlipat) satu catatan. Hanya ditampilkan bila pemanggil boleh mengubah. */
export function NoteEditForm({ noteId, body, visibility }: { noteId: string; body: string; visibility: "TSK_ONLY" | "SHARED_WITH_LPK" }) {
  const [visState, visAction] = useActionState<FormState, FormData>(updateNote, idle);
  const [bodyState, bodyAction] = useActionState<FormState, FormData>(updateNote, idle);
  const t = useTranslations("notes");
  const next = visibility === "TSK_ONLY" ? "SHARED_WITH_LPK" : "TSK_ONLY";
  return (
    <div className="space-y-2">
      <form action={visAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="noteId" value={noteId} />
        <input type="hidden" name="visibility" value={next} />
        <SubmitButton className={btnSecondary}>{next === "SHARED_WITH_LPK" ? t("makeShared") : t("makeTskOnly")}</SubmitButton>
        <FormAlert state={visState} />
      </form>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-brand-700">{t("editBody")}</summary>
        <form action={bodyAction} className="space-y-2 pt-2">
          <input type="hidden" name="noteId" value={noteId} />
          <textarea name="body" rows={3} required maxLength={4000} defaultValue={body} className={inputClass} />
          <FormAlert state={bodyState} />
          <SubmitButton>{t("save")}</SubmitButton>
        </form>
      </details>
    </div>
  );
}
