// Nada lencana per tahap kartu (dipakai bagian di detail pekerja dan daftar /records/cards). Warna bukan satu-satunya pembeda: lencana selalu berisi teks tahap.
import type { Tone } from "@/features/records/ui/common";
import type { CardStage } from "@/db/zairyu";

export const STAGE_TONE: Record<CardStage, Tone> = {
  none: "neutral", done: "ok", prepare: "info", can_apply: "info", waiting_result: "info", h30: "warn", h14: "danger", h7: "danger", expired: "danger", special_overdue: "danger", rejected: "danger",
};
