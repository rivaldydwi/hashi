import { tenantQuery, type CurrentUser } from "@/lib/session";
import { buildCompanySheet, buildJobOrderSheet, type CompanySheetData, type JobOrderSheetData } from "@/lib/pdf/client-sheet-model";
import { ExportDialog, type SheetModels } from "./ExportDialog";
import { loadCompanySheet, loadJobOrderSheet } from "./queries";

const combos = [["internal", "ja"], ["internal", "jaid"], ["share", "ja"], ["share", "jaid"]] as const;

function models<T>(build: (d: T, o: { mode: "internal" | "share"; lang: "ja" | "jaid"; preparedBy?: string }) => SheetModels[keyof SheetModels], data: T, me: CurrentUser): SheetModels {
  return Object.fromEntries(combos.map(([mode, lang]) => [`${mode}-${lang}`, build(data, { mode, lang, preparedBy: me.name })])) as SheetModels;
}

/** Tombol "Ekspor PDF" profil klien (seluruh perusahaan, atau satu lokasi bila `siteId`). Dirender server: data dimuat lewat RLS TSK. */
export async function ExportCompanySheet({ me, companyId, siteId }: { me: CurrentUser; companyId: string; siteId?: string }) {
  const data = await tenantQuery((tx) => loadCompanySheet(tx, companyId, siteId));
  if (!data) return null;
  const base = `/sheet/company/${companyId}${siteId ? `?site=${siteId}` : ""}`;
  return <ExportDialog testid="export-company" baseHref={base} models={models<CompanySheetData>(buildCompanySheet, data, me)} />;
}

export async function ExportJobOrderSheet({ me, jobOrderId }: { me: CurrentUser; jobOrderId: string }) {
  const data = await tenantQuery((tx) => loadJobOrderSheet(tx, jobOrderId));
  if (!data) return null;
  return <ExportDialog testid="export-job-order" baseHref={`/sheet/job-order/${jobOrderId}`} models={models<JobOrderSheetData>(buildJobOrderSheet, data, me)} />;
}
