import { getFormatter, getTranslations } from "next-intl/server";
import { DecisionBadge } from "@/components/DecisionBadge";
import { cardClass } from "@/components/styles";
import type { NoteVisibility, SelectionDecision } from "@/db/schema";
import type { CurrentUser } from "@/lib/session";
import type { Detail } from "./detail-queries";
import { DecisionForm, NoteAddForm, NoteEditForm, RowForm, SectionForm } from "./DetailForms";
import { getSkillFieldOptions } from "@/features/skill-fields/server";
import { isTskRole, type ContentAccess } from "./permissions";
import { toFormValue, type FieldDef, type ListSectionDef, type SingleSectionDef } from "./sections";

type Row = Record<string, unknown>;

async function useFormatValue(sectionKey: string) {
  const t = await getTranslations(`detail.sections.${sectionKey}`);
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const skill = new Map((await getSkillFieldOptions()).map((o) => [o.id, o.label]));
  return (f: FieldDef, raw: unknown): string => {
    if (f.kind === "boolean") return raw === true ? tc("yes") : tc("no");
    if (raw === null || raw === undefined || raw === "") return "—";
    if (f.kind === "date") return format.dateTime(new Date(`${String(raw)}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
    if (f.kind === "select") return t(`options.${f.name}.${String(raw)}`);
    if (f.kind === "skillField") return skill.get(String(raw)) ?? "—";
    if (f.kind === "int" && f.name === "heightCm") return `${raw} cm`;
    if (f.kind === "int" && f.name === "weightKg") return `${raw} kg`;
    return String(raw);
  };
}

/** Kartu satu bagian berbaris tunggal: tampilan baca + form ubah (hanya bila boleh). */
export async function SectionCard({
  candidateId,
  section,
  row,
  access,
  children,
}: {
  candidateId: string;
  section: SingleSectionDef;
  row: Row | null;
  access: ContentAccess;
  children?: React.ReactNode;
}) {
  const t = await getTranslations("detail");
  const ts = await getTranslations(`detail.sections.${section.key}`);
  const fmt = await useFormatValue(section.key);
  const values = Object.fromEntries(section.fields.map((f) => [f.name, toFormValue(f, row?.[f.name])]));

  return (
    <section className={`${cardClass} p-5`} data-testid={`section-${section.key}`}>
      <h2 className="font-medium">{ts("title")}</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {section.fields.map((f) => (
          <div key={f.name} className={f.kind === "textarea" ? "sm:col-span-2" : ""}>
            <dt className="text-xs text-stone-500">{ts(`fields.${f.name}`)}</dt>
            <dd className="whitespace-pre-line text-stone-900" data-testid={`value-${f.name}`}>{fmt(f, row?.[f.name])}</dd>
          </div>
        ))}
      </dl>
      {children}
      {access.canEdit && (
        <details className="mt-3 border-t border-stone-100 pt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">{t("edit")}</summary>
          <SectionForm candidateId={candidateId} section={section.key} fields={section.fields} values={values} />
        </details>
      )}
    </section>
  );
}

/** Kartu bagian berbaris banyak. */
export async function ListSectionCard({
  candidateId,
  section,
  rows,
  access,
}: {
  candidateId: string;
  section: ListSectionDef;
  rows: Row[];
  access: ContentAccess;
}) {
  const t = await getTranslations("detail");
  const ts = await getTranslations(`detail.sections.${section.key}`);
  const fmt = await useFormatValue(section.key);
  const byName = new Map(section.fields.map((f) => [f.name, f]));
  const valuesOf = (r: Row) => Object.fromEntries(section.fields.map((f) => [f.name, toFormValue(f, r[f.name])]));

  return (
    <section className={`${cardClass} p-5`} data-testid={`section-${section.key}`}>
      <h2 className="font-medium">{ts("title")}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{t("noRows")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {rows.map((r) => (
            <li key={String(r.id)} className="py-2.5" data-testid={`row-${section.key}`}>
              <p className="text-sm text-stone-900">
                {section.summary
                  .map((n) => fmt(byName.get(n)!, r[n]))
                  .filter((v) => v !== "—")
                  .join(" · ") || "—"}
              </p>
              {access.canEdit && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-brand-700">{t("edit")}</summary>
                  <RowForm candidateId={candidateId} section={section.key} fields={section.fields} values={valuesOf(r)} rowId={String(r.id)} canDelete={access.canDelete} />
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {access.canEdit && (
        <details className="mt-3 border-t border-stone-100 pt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">+ {t("addRow")}</summary>
          <RowForm key={rows.length} candidateId={candidateId} section={section.key} fields={section.fields} values={valuesOf({})} />
        </details>
      )}
    </section>
  );
}

/** Keputusan TSK: TSK memilih keputusannya sendiri; LPK_ADMIN hanya membaca keputusan semua TSK mitra. */
export async function DecisionPanel({ me, detail }: { me: CurrentUser; detail: NonNullable<Detail["full"]> & { candidateId: string } }) {
  const t = await getTranslations("detail");
  const format = await getFormatter();
  const tsk = isTskRole(me.role);
  const mine = detail.selections.find((s) => s.tskOrgId === me.organizationId);

  return (
    <section className={`${cardClass} p-5`} data-testid="section-decision">
      <h2 className="font-medium">{t("decisionTitle")}</h2>
      {tsk ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-stone-600">{t("decisionIntroTsk")}</p>
          <DecisionForm candidateId={detail.candidateId} decision={(mine?.decision ?? "NONE") as SelectionDecision} />
          {mine && (
            <p className="text-xs text-stone-500">{t("decidedAt", { date: format.dateTime(mine.decidedAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-stone-600">{t("decisionIntroLpk")}</p>
          {detail.selections.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">{t("noDecisions")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5" data-testid="decision-list">
              {detail.selections.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{s.tskName}</span>
                  <DecisionBadge decision={s.decision} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Catatan TSK. TSK: catatan organisasinya + form tambah. LPK_ADMIN: hanya yang dibagikan; disembunyikan bila kosong. */
export async function NotesPanel({ me, candidateId, notes }: { me: CurrentUser; candidateId: string; notes: NonNullable<Detail["full"]>["notes"] }) {
  const t = await getTranslations("notes");
  const format = await getFormatter();
  const tsk = isTskRole(me.role);
  if (!tsk && notes.length === 0) return null;

  const label = (v: NoteVisibility) => (v === "TSK_ONLY" ? t("labelTskOnly") : t("labelShared"));
  return (
    <section className={`${cardClass} p-5`} data-testid="section-notes">
      <h2 className="font-medium">{tsk ? t("title") : t("lpkTitle")}</h2>
      {notes.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{t("empty")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {notes.map((n) => {
            // Sama dengan aturan RLS: penulis, atau TSK_ADMIN di TSK yang sama
            const canModify = tsk && n.tskOrgId === me.organizationId && (n.authorId === me.id || me.role === "TSK_ADMIN");
            return (
              <li key={n.id} className="rounded-lg border border-stone-200 p-3" data-testid="note" data-visibility={n.visibility}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${n.visibility === "TSK_ONLY" ? "bg-stone-100 text-stone-700" : "bg-sky-50 text-sky-800"}`}
                    data-testid="note-label"
                  >
                    {label(n.visibility)}
                  </span>
                  <span className="text-stone-500">
                    {tsk && n.authorName ? t("author", { name: n.authorName }) : n.tskName} · {format.dateTime(n.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
                <p className="whitespace-pre-line text-sm text-stone-900" data-testid="note-body">{n.body}</p>
                {canModify && (
                  <div className="mt-2 border-t border-stone-100 pt-2">
                    <NoteEditForm noteId={n.id} body={n.body} visibility={n.visibility} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {tsk && (
        <details className="mt-3 border-t border-stone-100 pt-3" open={notes.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">+ {t("add")}</summary>
          <div className="pt-3"><NoteAddForm candidateId={candidateId} /></div>
        </details>
      )}
    </section>
  );
}
