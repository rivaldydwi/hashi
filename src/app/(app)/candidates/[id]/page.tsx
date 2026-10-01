import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { cardClass } from "@/components/styles";
import { ConsentDateForm, SharingForm, StageForm } from "@/features/candidates/DetailForms";
import { latestAllowedDate } from "@/features/candidates/validation";
import { getFormatter } from "next-intl/server";
import { DecisionPanel, ListSectionCard, NotesPanel, SectionCard } from "@/features/candidates/DetailSections";
import { loadDetail } from "@/features/candidates/detail-queries";
import { canSeeLevel, contentAccess, isTskRole } from "@/features/candidates/permissions";
import { AssessmentsSection } from "@/features/assessments/AssessmentsSection";
import { listMonthly } from "@/features/assessments/queries";
import { DocumentsSection } from "@/features/documents/DocumentsSection";
import { LIST_SECTIONS, SINGLE_SECTIONS } from "@/features/candidates/sections";
import { requireUser, tenantQuery } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Candidate" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireUser();
  if (me.role === "SUPER_ADMIN") redirect("/");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;

  const detail = await tenantQuery((tx) => loadDetail(tx, me, id));
  if (!detail) notFound(); // tidak ada, atau tidak terlihat oleh organisasi ini (RLS)
  // Penilaian bulanan LPK: hanya dibaca dan dirender untuk LPK_ADMIN dan sensei (sisi TSK = bagian C)
  const lpkSide = me.role === "LPK_ADMIN" || me.role === "LPK_SENSEI";
  const monthly = lpkSide ? await tenantQuery((tx) => listMonthly(tx, id)) : [];

  const t = await getTranslations("detail");
  const { candidate, full } = detail;
  const tsk = isTskRole(me.role);
  const access = contentAccess(me.role, candidate.stage, full?.myDecision ?? null);
  const ownerLpk = me.role === "LPK_ADMIN";
  const format = await getFormatter();
  // Tanggal ditampilkan dalam format lokal (id / ja); nilai di database tetap YYYY-MM-DD
  const consentText = candidate.dataConsentDate
    ? format.dateTime(new Date(`${candidate.dataConsentDate}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" })
    : "—";

  return (
    <>
      <PageHeader
        title={candidate.fullName}
        intro={candidate.nameKatakana ?? undefined}
        backHref="/candidates"
        backLabel={t("backToList")}
        action={<StageBadge stage={candidate.stage} />}
      />

      {sp.added && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="candidate-added">
          {t("added")}
        </p>
      )}

      <div className="space-y-4">
        <div className={`${cardClass} flex flex-wrap items-end justify-between gap-4 p-5`} data-testid="section-status">
          <div className="text-sm">
            <p className="text-xs text-stone-500">{t("lpkLabel")}</p>
            <p className="font-medium">{candidate.lpkName}</p>
            <p className="mt-2 text-xs text-stone-500">{t("consentLabel")}</p>
            <p data-testid="value-consent">{consentText}</p>
          </div>
          {ownerLpk ? (
            <StageForm candidateId={candidate.id} stage={candidate.stage} />
          ) : (
            tsk && <p className="max-w-sm text-xs text-stone-500">{t("stageInfoTsk")}</p>
          )}
        </div>

        {ownerLpk && (
          <div className={`${cardClass} space-y-4 p-5`} data-testid="section-sharing">
            <div>
              <h2 className="font-medium">{t("sharing.title")}</h2>
              <p
                className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${candidate.sharedWithTsk ? "bg-sky-50 text-sky-800" : "bg-stone-100 text-stone-700"}`}
                data-testid="sharing-state"
              >
                {candidate.sharedWithTsk ? t("sharing.stateOn") : t("sharing.stateOff")}
              </p>
              <p className="mt-2 text-sm text-stone-600">{candidate.sharedWithTsk ? t("sharing.introOn") : t("sharing.introOff")}</p>
            </div>
            <SharingForm candidateId={candidate.id} shared={candidate.sharedWithTsk} />
            <div className="border-t border-stone-100 pt-4">
              <ConsentDateForm candidateId={candidate.id} date={candidate.dataConsentDate ?? ""} maxDate={latestAllowedDate()} />
            </div>
          </div>
        )}

        {tsk && !access.canEdit && access.readOnlyReason && (
          <p role="note" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="readonly-note">
            {t(`readOnly.${access.readOnlyReason}`)}
          </p>
        )}

        {tsk && full && <DecisionPanel me={me} detail={{ ...full, candidateId: candidate.id }} />}

        {SINGLE_SECTIONS.filter((s) => canSeeLevel(me.role, s.level)).map((s) => (
          <SectionCard
            key={s.key}
            candidateId={candidate.id}
            section={s}
            row={s.table === "candidates" ? (candidate as Record<string, unknown>) : (full?.priv as Record<string, unknown> | null)}
            access={access}
          />
        ))}

        {full &&
          LIST_SECTIONS.map((s) => (
            <ListSectionCard key={s.key} candidateId={candidate.id} section={s} rows={full.lists[s.key as keyof typeof full.lists] as Record<string, unknown>[]} access={access} />
          ))}

        {full && <DocumentsSection candidateId={candidate.id} docs={full.documents} canEdit={access.canEdit} />}

        {lpkSide && <AssessmentsSection candidateId={candidate.id} rows={monthly} me={me} />}

        {ownerLpk && full && <DecisionPanel me={me} detail={{ ...full, candidateId: candidate.id }} />}
        {full && <NotesPanel me={me} candidateId={candidate.id} notes={full.notes} />}
      </div>
    </>
  );
}
