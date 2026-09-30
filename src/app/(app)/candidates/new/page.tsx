import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { CandidateCreateForm } from "@/features/candidates/CandidateCreateForm";
import { listFields } from "@/features/candidates/queries";
import { latestAllowedDate } from "@/features/candidates/validation";
import { requireRole, tenantQuery } from "@/lib/session";

export default async function NewCandidatePage() {
  await requireRole("LPK_ADMIN"); // hanya admin LPK yang boleh menambah kandidat
  const t = await getTranslations("candidates");
  const fields = await tenantQuery((tx) => listFields(tx));

  return (
    <>
      <PageHeader title={t("newTitle")} intro={t("newIntro")} backHref="/candidates" backLabel={t("title")} />
      <CandidateCreateForm fieldSuggestions={fields} maxDate={latestAllowedDate()} />
    </>
  );
}
