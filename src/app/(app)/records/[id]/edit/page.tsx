import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MAX_ATTACHMENTS_PER_RECORD, cleanSections } from "@/db/records-core";
import { requireStaff } from "@/features/records/access";
import { loadFormContext, localDateTime } from "@/features/records/form-context";
import { getRecord } from "@/features/records/queries";
import { RecordForm } from "@/features/records/ui/RecordForm";
import { roleLabelMap } from "@/features/records/ui/common";
import { safeTimezone } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("records");
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const { rec, ctx } = await tenantQuery(async (tx) => ({ rec: await getRecord(tx, id), ctx: await loadFormContext(tx) }));
  if (!rec) notFound();
  const r = rec.r;
  const canEdit = r.status === "active" && (r.authorId === me.id || r.createdBy === me.id || me.role === "TSK_ADMIN");
  if (!canEdit) notFound();
  // pekerja yang sudah tertaut tetap muncul walau tidak lagi aktif
  const workers = [...ctx.workers];
  for (const s of rec.subjects) if (!workers.some((w) => w.id === s.id)) workers.push({ id: s.id, name: s.name, katakana: s.katakana, site: "" });
  return (
    <>
      <h2 className="mb-4 text-[19px] font-semibold">{t("edit.title")}</h2>
      <RecordForm
        kind={r.kind as "daily_work" | "meeting"}
        me={{ id: me.id, role: me.role }}
        staff={ctx.staff}
        workers={workers}
        sites={ctx.sites}
        companies={ctx.companies}
        cases={ctx.cases.some((c) => c.id === r.caseId) || !r.caseId ? ctx.cases : [...ctx.cases, { id: r.caseId, label: rec.caseCode ?? r.caseId }]}
        roleLabels={await roleLabelMap()}
        photosLeft={Math.max(0, MAX_ATTACHMENTS_PER_RECORD - rec.attachments.length)}
        initial={{
          id: r.id, recordDate: r.recordDate, authorId: r.authorId, subjects: rec.subjects.map((s) => s.id), clientSiteId: r.clientSiteId ?? "", caseId: r.caseId ?? "", recipients: rec.recipients.map((x) => x.id),
          workType: r.workType ?? "interview", workTypeOther: r.workTypeOther ?? "", actionTaken: r.actionTaken ?? "", result: r.result ?? "", pending: r.pending ?? "", nextAction: r.nextAction ?? "", reportToText: r.reportToText ?? "", note: r.note ?? "",
          meetingSubject: r.subject ?? "", startedAt: localDateTime(r.startedAt, tz), endedAt: localDateTime(r.endedAt, tz), method: r.method ?? "", counterparty: r.counterparty ?? "client", clientCompanyId: r.clientCompanyId ?? "",
          handlers: rec.handlers.map((h) => h.id), sections: cleanSections(r.sections),
        }}
      />
    </>
  );
}
