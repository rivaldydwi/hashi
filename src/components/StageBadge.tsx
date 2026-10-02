import type { CandidateStage } from "@/db/schema";
import { StatusBadge } from "./StatusBadge";

export const StageBadge = ({ stage }: { stage: CandidateStage }) => <StatusBadge kind="stage" code={stage} />;
