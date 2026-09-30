import { getTranslations } from "next-intl/server";
import type { CandidateStage } from "@/db/schema";

const STYLES: Record<CandidateStage, string> = {
  STUDYING: "bg-stone-100 text-stone-700",
  READY: "bg-sky-50 text-sky-800",
  SHORTLISTED: "bg-indigo-50 text-indigo-800",
  PASSED_TSK_INTERVIEW: "bg-violet-50 text-violet-800",
  SUBMITTED_TO_CLIENT: "bg-amber-50 text-amber-800",
  PASSED_CLIENT_INTERVIEW: "bg-emerald-50 text-emerald-800",
  DOCUMENT_PROCESS: "bg-teal-50 text-teal-800",
  DEPARTED: "bg-green-100 text-green-900",
  WITHDRAWN: "bg-rose-50 text-rose-800",
};

export async function StageBadge({ stage }: { stage: CandidateStage }) {
  const t = await getTranslations("stages");
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[stage]}`}>
      {t(stage)}
    </span>
  );
}
