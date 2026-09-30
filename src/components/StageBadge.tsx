import { getTranslations } from "next-intl/server";
import type { CandidateStage } from "@/db/schema";

const STYLES: Record<CandidateStage, string> = {
  STUDYING: "bg-stone-100 text-stone-700",
  READY: "bg-sky-50 text-sky-800",
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
