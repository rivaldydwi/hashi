import type { SelectionDecision } from "@/db/schema";
import { StatusBadge } from "./StatusBadge";

/** Keputusan TSK atas kandidat. null = belum ada baris keputusan (ditampilkan sebagai NONE). */
export const DecisionBadge = ({ decision }: { decision: SelectionDecision | null }) => <StatusBadge kind="decision" code={decision} />;
