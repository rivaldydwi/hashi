import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { btnSecondary } from "@/components/styles";
import { requireStaff } from "@/features/records/access";
import { loadCaseForPdf } from "@/features/records/export-data";
import { ClientExportPreview } from "@/features/records/ui/ClientExportPreview";
import { jaDateTime } from "@/lib/pdf/dates";
import { safeTimezone } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pratinjau ekspor 時系列 untuk KLIEN: hanya baris yang ikut ekspor, tanpa nama staf dan kode kasus internal; unduh butuh centang konfirmasi. */
export default async function CaseClientExportPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("records");
  void (await getLocale());
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const d = await tenantQuery((tx) => loadCaseForPdf(tx, id));
  if (!d) notFound();
  const incl = d.events.filter((e) => e.status === "active" && e.includeInClientExport);
  return (
    <>
      <h2 className="mb-4 text-[19px] font-semibold">{t("export.clientTitle")}</h2>
      <ClientExportPreview
        caseId={id}
        title={d.kase.title}
        subjects={d.kase.subjects.join("、")}
        excluded={d.events.length - incl.length}
        rows={incl.map((e) => ({ when: jaDateTime(e.occurredAt, tz, e.timeKnown), event: e.event, subjectStatement: e.subjectStatement ?? "", companyResponse: e.companyResponse ?? "", note: e.note ?? "" }))}
      />
      <Link href={`/records/cases/${id}`} className={`${btnSecondary} mt-4`}>{t("export.backToCase")}</Link>
    </>
  );
}
