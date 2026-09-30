import { getTranslations } from "next-intl/server";
import type { SelectionDecision } from "@/db/schema";

const STYLES: Record<SelectionDecision, string> = {
  NONE: "bg-stone-100 text-stone-600",
  SHORTLISTED: "bg-indigo-50 text-indigo-800",
  PASSED_TSK_INTERVIEW: "bg-violet-50 text-violet-800",
  SUBMITTED_TO_CLIENT: "bg-amber-50 text-amber-800",
  PASSED_CLIENT_INTERVIEW: "bg-emerald-50 text-emerald-800",
  DOCUMENT_PROCESS: "bg-teal-50 text-teal-800",
  DEPARTED: "bg-green-100 text-green-900",
  REJECTED: "bg-rose-50 text-rose-800",
};

/** Keputusan TSK atas kandidat. null = belum ada baris keputusan (ditampilkan sebagai NONE). */
export async function DecisionBadge({ decision }: { decision: SelectionDecision | null }) {
  const t = await getTranslations("decisions");
  const value = decision ?? "NONE";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[value]}`}>{t(value)}</span>
  );
}
