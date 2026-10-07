import { getLocale, getTranslations } from "next-intl/server";
import { Data } from "@/components/Data";
import { cardClass } from "@/components/styles";
import { cardStage } from "@/db/zairyu";
import { Badge } from "@/features/records/ui/common";
import { RevisionHistory, toSnake, type RevField } from "@/features/records/ui/RevisionHistory";
import type { CardRow, CardSectionData } from "../queries";
import { STAGE_TONE } from "../stage";
import { CardSecrets } from "./CardSecrets";
import { CreateCardForm, HandOverForm, ReceiveCardForm, UpdateCardForm, VoidCardForm, type FieldOption } from "./CardForms";

const slash = (ymd: string | null | undefined) => (ymd ? ymd.replace(/-/g, "/") : "—");

/**
 * Bagian "在留カード" di halaman pekerja (T-018): kartu terkini + tahap pengingat (cardStage), form ubah/terima/batalkan HANYA bila boleh (担当 efektif atau TSK_ADMIN),
 * selain itu baca-saja dengan penjelasan siapa yang boleh mengubah; riwayat kartu dan riwayat edit. Tanggal ditandai `translate="no"`; catatan, alasan batal, dan label (bidang, masa berlaku) boleh diterjemahkan (T-023).
 */
export async function CardSection({ candidateId, data, fieldOptions, today, tz }: { candidateId: string; data: CardSectionData; fieldOptions: FieldOption[]; today: string; tz: string }) {
  const t = await getTranslations("cards");
  const locale = await getLocale();
  const { cards, current, revisions, defaultFieldId, access, secrets } = data;
  const fieldName = (id: string) => fieldOptions.find((f) => f.id === id)?.label ?? "—";
  /** Bidang yang boleh dipilih: yang aktif, ditambah yang sedang dipakai kartu/pekerja ini (bidang nonaktif tidak muncul untuk pilihan baru). */
  const usable = (extra?: string): FieldOption[] => fieldOptions.filter((f) => f.active !== false || f.id === extra || f.id === defaultFieldId);
  const stage = current ? cardStage({ expiryDate: current.expiryDate, renewalStatus: current.renewalStatus as never, receivedOn: current.receivedOn, today }) : null;
  const editable = access.canEdit && current && current.status === "active" && current.renewalStatus !== "received";
  const names = Object.fromEntries(fieldOptions.map((f) => [f.id, f.label]));
  const revFields: RevField[] = [
    { key: "renewal_status", label: t("form.status") }, { key: "expiry_date", label: t("form.expiry") }, { key: "period_months", label: t("form.period") }, { key: "skill_field_id", label: t("form.skillField") },
    { key: "applied_on", label: t("form.appliedOn") }, { key: "additional_docs_on", label: t("form.additionalDocsOn") }, { key: "rejected_on", label: t("form.rejectedOn") },
    { key: "received_on", label: t("form.receivedOn") }, { key: "received_by", label: t("form.receivedBy") }, { key: "handed_over_on", label: t("form.handedOverOn") },
    { key: "note", label: t("form.note") }, { key: "status", label: t("history.status") }, { key: "void_reason", label: t("form.voidReason") },
  ];
  const daysText = !stage ? "" : stage.daysLeft > 0 ? t("daysLeft", { n: stage.daysLeft }) : stage.daysLeft === 0 ? t("lastDay") : t("daysPast", { n: -stage.daysLeft });

  return (
    <section className={`${cardClass} space-y-4 p-4 sm:p-5`} aria-labelledby="card-title" data-testid="card-section" data-can-edit={access.canEdit ? "true" : "false"} data-has-card={current ? "true" : "false"}>
      <div>
        <h3 id="card-title" className="text-[16px] font-semibold">{t("title")}</h3>
        <p className="text-sm text-ink-2">{t("intro")}</p>
      </div>

      {!access.canEdit && (
        <p className="rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink-menu" data-testid="card-readonly">
          {!access.activeWorker ? t("access.noActive") : access.responsible?.name ? t.rich("access.readOnly", { name: access.responsible.name, n: (c) => <Data className="font-medium">{c}</Data> }) : t("access.readOnlyNone")}
        </p>
      )}

      {!current ? (
        <div className="space-y-3" data-testid="card-empty">
          <p className="text-sm text-ink-2">{t("empty")}</p>
          {access.canEdit && access.activeWorker && defaultFieldId && (
            <details className="rounded-xl border border-line p-3" open>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{t("form.createTitle")}</summary>
              <div className="mt-2"><CreateCardForm candidateId={candidateId} defaultFieldId={defaultFieldId} fields={usable()} /></div>
            </details>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2 rounded-xl border border-line p-3 sm:p-4" data-testid="card-current" data-card-id={current.id} data-stage={stage!.stage} data-renewal={current.renewalStatus}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STAGE_TONE[stage!.stage]} testId="card-stage">{t(`stage.${stage!.stage}`)}</Badge>
              <Badge tone="neutral" testId="card-renewal">{t(`renewal.${current.renewalStatus}`)}</Badge>
              {stage!.additionalDocs && <Badge tone="warn" testId="card-additional">{t("flags.additionalDocs")}</Badge>}
            </div>
            <p className="text-xs text-ink-2" data-testid="card-stage-help">{t(`stageHelp.${stage!.stage}`)}</p>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-ink-2">{t("form.expiry")}: </dt><dd className="inline font-medium" translate="no" data-testid="card-expiry">{slash(current.expiryDate)}</dd> <span className="text-xs text-ink-2" data-testid="card-days">({daysText})</span></div>
              <div><dt className="inline text-ink-2">{t("form.period")}: </dt><dd className="inline">{current.periodMonths ? t("periodMonths", { n: current.periodMonths }) : "—"}</dd></div>
              <div><dt className="inline text-ink-2">{t("form.skillField")}: </dt><dd className="inline">{fieldName(current.skillFieldId)}</dd></div>
              {current.appliedOn && <div><dt className="inline text-ink-2">{t("form.appliedOn")}: </dt><dd className="inline" translate="no" data-testid="card-applied">{slash(current.appliedOn)}</dd></div>}
              {current.additionalDocsOn && <div><dt className="inline text-ink-2">{t("form.additionalDocsOn")}: </dt><dd className="inline" translate="no">{slash(current.additionalDocsOn)}</dd></div>}
              {current.rejectedOn && <div><dt className="inline text-ink-2">{t("form.rejectedOn")}: </dt><dd className="inline" translate="no">{slash(current.rejectedOn)}</dd></div>}
              {current.receivedOn && <div><dt className="inline text-ink-2">{t("form.receivedOn")}: </dt><dd className="inline" translate="no">{slash(current.receivedOn)}</dd></div>}
            </dl>
            {stage!.specialUntil && <p className="text-sm text-amber-900" data-testid="card-special">{t("flags.special", { date: slash(stage!.specialUntil) })}</p>}
            {current.note && <p className="whitespace-pre-wrap break-words text-sm text-ink-menu" data-testid="card-note">{current.note}</p>}
          </div>

          {current.status === "active" && (
            access.canEdit && secrets[current.id] ? (
              <div className="rounded-xl border border-line p-3 sm:p-4"><CardSecrets cardId={current.id} meta={secrets[current.id]} /></div>
            ) : (
              <p className="text-xs text-ink-2" data-testid="card-secrets-restricted">{t("secrets.restricted")}</p>
            )
          )}

          {editable && (
            <div className="space-y-3" data-testid="card-actions">
              <details className="rounded-xl border border-line p-3">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold" data-testid="card-edit-toggle">{t("form.updateTitle")}</summary>
                <div className="mt-2"><UpdateCardForm today={today} fields={usable(current.skillFieldId)} card={{ id: current.id, skillFieldId: current.skillFieldId, periodMonths: current.periodMonths, expiryDate: current.expiryDate, renewalStatus: current.renewalStatus, appliedOn: current.appliedOn, additionalDocsOn: current.additionalDocsOn, rejectedOn: current.rejectedOn, note: current.note }} /></div>
              </details>
              {(current.renewalStatus === "applied" || current.renewalStatus === "additional_docs") && (
                <details className="rounded-xl border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold" data-testid="card-receive-toggle">{t("form.receiveTitle")}</summary>
                  <div className="mt-2"><ReceiveCardForm today={today} fields={usable(current.skillFieldId)} card={{ id: current.id, skillFieldId: current.skillFieldId, periodMonths: current.periodMonths, expiryDate: current.expiryDate }} /></div>
                </details>
              )}
              <details className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-rose-900" data-testid="card-void-toggle">{t("form.voidTitle")}</summary>
                <p className="mt-2 text-xs text-ink-2">{t("secrets.voidNote")}</p>
                <div className="mt-2"><VoidCardForm id={current.id} /></div>
              </details>
            </div>
          )}
        </>
      )}

      {cards.length > 0 && (
        <div data-testid="card-history">
          <h4 className="mb-2 text-sm font-semibold">{t("history.title")}</h4>
          <ol className="divide-y divide-line rounded-xl border border-line">
            {cards.map((c: CardRow) => (
              <li key={c.id} className={`space-y-1 px-3 py-2 text-sm ${c.status === "void" ? "opacity-70" : ""}`} data-testid="card-history-item" data-card-id={c.id} data-status={c.status} data-renewal={c.renewalStatus}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" translate="no">{slash(c.expiryDate)}</span>
                  <Badge tone="neutral">{t(`renewal.${c.renewalStatus}`)}</Badge>
                  {c.status === "void" && <Badge tone="danger">{t("history.void")}</Badge>}
                  {current && c.id === current.id && c.status === "active" && <Badge tone="accent">{t("history.currentBadge")}</Badge>}
                  <span className="text-xs text-ink-2">{c.periodMonths ? t("periodMonths", { n: c.periodMonths }) : ""}</span>
                </div>
                {c.renewalStatus === "received" && (
                  <p className="text-xs text-ink-2" data-testid="card-history-received">
                    {t("history.received", { date: slash(c.receivedOn), by: t(`receivedBy.${c.receivedBy ?? "staff"}`) })}
                    {c.receivedBy === "staff" && (c.handedOverOn ? ` · ${t("history.handedOver", { date: slash(c.handedOverOn) })}` : ` · ${t("history.notHandedOver")}`)}
                  </p>
                )}
                {c.status === "void" && c.voidReason && <p className="text-xs text-rose-900">{t("history.voidedBecause")}: {c.voidReason}</p>}
                {access.canEdit && c.status === "active" && c.id !== current?.id && secrets[c.id] && (
                  <details className="mt-1"><summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold text-accent-text" data-testid="card-history-secrets-toggle">{t("secrets.title")}</summary><div className="mt-1"><CardSecrets cardId={c.id} meta={secrets[c.id]} testPrefix="card-history" /></div></details>
                )}
                {access.canEdit && c.status === "active" && c.renewalStatus === "received" && c.receivedBy === "staff" && !c.handedOverOn && c.receivedOn && (
                  <details className="mt-1"><summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold text-accent-text" data-testid="card-handover-toggle">{t("form.handOverTitle")}</summary><div className="mt-1"><HandOverForm id={c.id} today={today} receivedOn={c.receivedOn} /></div></details>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {current && (
        <details data-testid="card-revisions-wrap">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{t("history.edits")}</summary>
          <div className="mt-2"><RevisionHistory revisions={revisions} current={toSnake(current as unknown as Record<string, unknown>)} fields={revFields} names={names} tz={tz} testId="card-history-edits" /></div>
        </details>
      )}
    </section>
  );
}
