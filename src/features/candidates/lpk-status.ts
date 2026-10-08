// Status pekerja untuk LPK (T-024): HANYA lewat fungsi sempit `lpk_worker_status(candidate_id)` (SECURITY DEFINER). LPK tidak punya akses SELECT ke placements/residence_cards.
// Mengembalikan tepat tiga hal: tanggal tiba, status visa (none | valid | renewing | expired), dan masa berlaku sampai. null = bukan LPK_ADMIN pemilik, belum berangkat, tidak dibagikan, kemitraan nonaktif.
import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { VISA_STATES, type VisaState } from "@/db/zairyu";

export type LpkWorkerStatus = { arrivedOn: string | null; visaState: VisaState; validUntil: string | null };

export async function loadLpkWorkerStatus(tx: Tx, candidateId: string): Promise<LpkWorkerStatus | null> {
  const res = await tx.execute(sql`select lpk_worker_status(${candidateId}::uuid) as s`);
  const s = (res.rows[0] as { s: { arrived_on: string | null; visa_state: string; valid_until: string | null } | null } | undefined)?.s;
  if (!s) return null;
  if (!(VISA_STATES as readonly string[]).includes(s.visa_state)) return null; // nilai tak dikenal: jangan tampilkan apa pun
  return { arrivedOn: s.arrived_on, visaState: s.visa_state as VisaState, validUntil: s.valid_until };
}
