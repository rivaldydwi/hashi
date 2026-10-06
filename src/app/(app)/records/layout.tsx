import { getTranslations } from "next-intl/server";
import { unreadRecordIds, unreadReportIds } from "@/db/records-queries";
import { requireStaff } from "@/features/records/access";
import { RecordsTabs } from "@/features/records/ui/Tabs";
import { tenantQuery } from "@/lib/session";

// Catatan kegiatan: HANYA TSK_ADMIN/TSK_STAFF. Peran lain mendapat 404 untuk semua rute di bawah /records.
export default async function RecordsLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  const unread = await tenantQuery(async (tx) => (await unreadRecordIds(tx, me.id)).length + (await unreadReportIds(tx, me.id)).length);
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">{t("intro")}</p>
      <RecordsTabs
        label={t("tabsLabel")}
        tabs={[
          { href: "/records", label: t("tabs.daily"), badge: unread },
          { href: "/records/meetings", label: t("tabs.meetings") },
          { href: "/records/cases", label: t("tabs.cases") },
          { href: "/records/interviews", label: t("tabs.interviews") },
          { href: "/records/tasks", label: t("tabs.tasks") },
          { href: "/records/responsible", label: t("tabs.responsible") },
        ]}
      />
      {children}
    </>
  );
}
