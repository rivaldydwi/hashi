import { getTranslations } from "next-intl/server";
import { MAX_ATTACHMENTS_PER_RECORD } from "@/db/records-core";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { activityRecordSubjects, activityRecords } from "@/db/schema";
import { requireStaff } from "@/features/records/access";
import { openTasksOfWorker, recentRecordsOfWorker, workerBasics } from "@/features/records/queries";
import { ContinuePanel } from "@/features/records/ui/ContinuePanel";
import { loadFormContext, localDateTime } from "@/features/records/form-context";
import { RecordForm } from "@/features/records/ui/RecordForm";
import { roleLabelMap } from "@/features/records/ui/common";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewRecordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  let kind: "daily_work" | "meeting" = one(sp.kind) === "meeting" ? "meeting" : "daily_work";
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const ctx = await tenantQuery((tx) => loadFormContext(tx));
  let worker = UUID.test(one(sp.worker)) && ctx.workers.some((w) => w.id === one(sp.worker)) ? one(sp.worker) : "";
  let caseId = UUID.test(one(sp.case)) && ctx.cases.some((c) => c.id === one(sp.case)) ? one(sp.case) : "";
  let siteId = "";
  let subjects: string[] = worker ? [worker] : [];
  const autoFilled: Array<"subjects" | "site" | "case"> = [];

  // "Lanjutkan" (T-007): pekerja, lokasi (配属先), dan kasus diambil dari catatan asal; ringkasan 3 catatan terakhir + tindak lanjut terbuka di panel
  const continueRaw = one(sp.continue);
  let panel: React.ReactNode = null;
  let continuesRecordId: string | undefined;
  if (continueRaw) {
    if (!UUID.test(continueRaw)) notFound();
    const parent = await tenantQuery(async (tx) => {
      const [p] = await tx.select({ id: activityRecords.id, kind: activityRecords.kind, status: activityRecords.status, recordDate: activityRecords.recordDate, siteId: activityRecords.clientSiteId, caseId: activityRecords.caseId }).from(activityRecords).where(eq(activityRecords.id, continueRaw)).limit(1);
      if (!p || p.status !== "active") return null;
      const subs = (await tx.select({ c: activityRecordSubjects.candidateId }).from(activityRecordSubjects).where(eq(activityRecordSubjects.recordId, p.id))).map((r) => r.c);
      return { ...p, subs };
    });
    const usable = parent ? parent.subs.filter((s) => ctx.workers.some((w) => w.id === s)) : [];
    if (!parent || usable.length === 0) notFound(); // tidak ada/tidak terlihat (RLS), sudah dibatalkan, atau tidak ada pekerja aktif yang bisa dilanjutkan
    kind = parent.kind === "meeting" ? "meeting" : "daily_work";
    subjects = usable;
    worker = usable[0];
    autoFilled.push("subjects");
    if (parent.siteId && ctx.sites.some((s) => s.id === parent.siteId)) { siteId = parent.siteId; autoFilled.push("site"); }
    if (parent.caseId && ctx.cases.some((c) => c.id === parent.caseId)) { caseId = parent.caseId; autoFilled.push("case"); }
    continuesRecordId = parent.id;
    const extra = await tenantQuery(async (tx) => ({ w: await workerBasics(tx, worker), recent: await recentRecordsOfWorker(tx, worker, 3), tasks: await openTasksOfWorker(tx, worker) }));
    if (extra.w) panel = <ContinuePanel worker={{ id: extra.w.id, name: extra.w.name }} recent={extra.recent} tasks={extra.tasks} parentDate={parent.recordDate} />;
  }
  const now = new Date();
  return (
    <>
      <h2 className="mb-4 text-[19px] font-semibold">{continuesRecordId ? t("continue.title") : kind === "meeting" ? t("meetings.newTitle") : t("daily.newTitle")}</h2>
      <div className={panel ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" : ""}>
      {panel && <div className="lg:order-2 lg:sticky lg:top-4">{panel}</div>}
      <div className="min-w-0">
      <RecordForm
        autoFilled={autoFilled}
        continuesRecordId={continuesRecordId}
        kind={kind}
        me={{ id: me.id, role: me.role }}
        staff={ctx.staff}
        workers={ctx.workers}
        sites={ctx.sites}
        companies={ctx.companies}
        cases={ctx.cases}
        roleLabels={await roleLabelMap()}
        photosLeft={MAX_ATTACHMENTS_PER_RECORD}
        initial={{
          recordDate: ymdIn(now, tz), authorId: me.id, subjects, clientSiteId: siteId, caseId, recipients: [],
          workType: "interview", workTypeOther: "", actionTaken: "", result: "", pending: "", nextAction: "", reportToText: "", note: "",
          meetingSubject: "", startedAt: localDateTime(now, tz), endedAt: "", method: "", counterparty: "client", clientCompanyId: "", handlers: [me.id], sections: {},
        }}
      />
      </div>
      </div>
    </>
  );
}
