import { getTranslations } from "next-intl/server";
import { MAX_ATTACHMENTS_PER_RECORD } from "@/db/records-core";
import { requireStaff } from "@/features/records/access";
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
  const kind = one(sp.kind) === "meeting" ? "meeting" : "daily_work";
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const ctx = await tenantQuery((tx) => loadFormContext(tx));
  const worker = UUID.test(one(sp.worker)) && ctx.workers.some((w) => w.id === one(sp.worker)) ? one(sp.worker) : "";
  const caseId = UUID.test(one(sp.case)) && ctx.cases.some((c) => c.id === one(sp.case)) ? one(sp.case) : "";
  const now = new Date();
  return (
    <>
      <h2 className="mb-4 text-[19px] font-semibold">{kind === "meeting" ? t("meetings.newTitle") : t("daily.newTitle")}</h2>
      <RecordForm
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
          recordDate: ymdIn(now, tz), authorId: me.id, subjects: worker ? [worker] : [], clientSiteId: "", caseId, recipients: [],
          workType: "interview", workTypeOther: "", actionTaken: "", result: "", pending: "", nextAction: "", reportToText: "", note: "",
          meetingSubject: "", startedAt: localDateTime(now, tz), endedAt: "", method: "", counterparty: "client", clientCompanyId: "", handlers: [me.id], sections: {},
        }}
      />
    </>
  );
}
