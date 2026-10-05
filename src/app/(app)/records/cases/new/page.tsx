import { getTranslations } from "next-intl/server";
import { btnSecondary, cardClass, inputClass, labelClass } from "@/components/styles";
import { CASE_CATEGORIES } from "@/db/records-core";
import { requireStaff } from "@/features/records/access";
import { saveCase } from "@/features/records/actions";
import { loadFormContext } from "@/features/records/form-context";
import { ActionForm } from "@/features/records/ui/ActionForm";
import { WorkerPicker } from "@/features/records/ui/Pickers";
import { tenantQuery } from "@/lib/session";
import Link from "next/link";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewCasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff();
  const t = await getTranslations("records");
  const tc = await getTranslations("common");
  const sp = await searchParams;
  const w = Array.isArray(sp.worker) ? sp.worker[0] : sp.worker;
  const ctx = await tenantQuery((tx) => loadFormContext(tx));
  return (
    <>
      <h2 className="mb-4 text-[19px] font-semibold">{t("cases.newTitle")}</h2>
      <div className={`${cardClass} p-4 sm:p-5`}>
        <ActionForm action={saveCase} submitLabel={t("cases.create")} redirectTo="/records/cases/{id}" className="space-y-4" testId="case-form">
          <div className="space-y-1.5"><label htmlFor="title" className={labelClass}>{t("cases.titleLabel")} *</label><input id="title" name="title" required maxLength={300} lang="ja" className={inputClass} /></div>
          <div className="space-y-1.5"><label htmlFor="category" className={labelClass}>{t("cases.category")} *</label>
            <select id="category" name="category" className={inputClass}>{CASE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</select></div>
          <div className="space-y-1.5"><span className={labelClass}>{t("cases.workers")}</span><WorkerPicker workers={ctx.workers} selected={w && UUID.test(w) ? [w] : []} /></div>
        </ActionForm>
        <Link href="/records/cases" className={`${btnSecondary} mt-3`}>{tc("back")}</Link>
      </div>
    </>
  );
}
