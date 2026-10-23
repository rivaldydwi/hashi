import type { JobOrderStatus } from "@/db/schema";

export const STATUS_STYLE: Record<JobOrderStatus, string> = {
  OPEN: "bg-ok-bg text-ok-text",
  FILLED: "bg-info-bg text-info-text",
  CLOSED: "bg-muted-strong text-ink-menu",
};
