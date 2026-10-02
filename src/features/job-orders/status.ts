import type { JobOrderStatus } from "@/db/schema";

export const STATUS_STYLE: Record<JobOrderStatus, string> = {
  OPEN: "bg-emerald-50 text-emerald-800",
  FILLED: "bg-sky-50 text-sky-800",
  CLOSED: "bg-stone-200 text-stone-700",
};
