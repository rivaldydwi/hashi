// Inti murni penanggung jawab pekerja (T-010; tanpa DB/React): siapa penanggung jawab EFEKTIF dan beban kerja per staf. Dipakai aplikasi, seed, dan tes.
import { WORKLOAD } from "./workload-config";

/** Satu baris riwayat penetapan (perusahaan ATAU penempatan). `staffId` null = dikosongkan. */
export type AssignmentRow = { staffId: string | null; effectiveFrom: string; createdAt: string };
export type EffectiveResponsible = { staffId: string | null; source: "placement" | "company" | "none" };

/** Penetapan yang berlaku pada `today`: yang terbaru dengan tanggal mulai berlaku <= today (seri: yang dibuat paling akhir). Null bila belum ada yang berlaku. */
export function currentAssignment(rows: AssignmentRow[], today: string): AssignmentRow | null {
  const eligible = rows.filter((r) => r.effectiveFrom <= today);
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom || (b.effectiveFrom === a.effectiveFrom && b.createdAt > a.createdAt) ? b : a));
}

/**
 * Penanggung jawab efektif seorang pekerja: pilihan PER PEKERJA (penempatan) bila ada dan terisi; kalau tidak (tidak ada, atau dikosongkan = "ikut perusahaan"), dari PERUSAHAANNYA;
 * kalau perusahaan juga kosong = tanpa penanggung jawab.
 */
export function effectiveResponsible(placementRows: AssignmentRow[], companyRows: AssignmentRow[], today: string): EffectiveResponsible {
  const p = currentAssignment(placementRows, today);
  if (p?.staffId) return { staffId: p.staffId, source: "placement" };
  const c = currentAssignment(companyRows, today);
  if (c?.staffId) return { staffId: c.staffId, source: "company" };
  return { staffId: null, source: "none" };
}

export type WorkloadLevel = "ok" | "warn" | "over";
/** ok < 45; warn 45..50 (50 = batas tercapai, belum melebihi); over > 50. */
export function workloadLevel(n: number): WorkloadLevel {
  return n > WORKLOAD.max ? "over" : n >= WORKLOAD.warnAt ? "warn" : "ok";
}

/**
 * Beban per staf = jumlah pekerja yang SEDANG BEKERJA (penempatan ACTIVE; ENDED tidak dihitung) dengan penanggung jawab efektif staf itu.
 * `staffIds` = semua staf TSK (yang belum memegang siapa pun tetap muncul dengan 0). Hasil urut beban menurun lalu nama.
 */
export function workloadByStaff(workers: Array<{ status: "ACTIVE" | "ENDED"; responsibleId: string | null }>, staffIds: string[]): Array<{ staffId: string; count: number; level: WorkloadLevel }> {
  const counts = new Map<string, number>(staffIds.map((id) => [id, 0]));
  for (const w of workers) if (w.status === "ACTIVE" && w.responsibleId) counts.set(w.responsibleId, (counts.get(w.responsibleId) ?? 0) + 1);
  return [...counts.entries()].map(([staffId, count]) => ({ staffId, count, level: workloadLevel(count) })).sort((a, b) => b.count - a.count || a.staffId.localeCompare(b.staffId));
}

/** Pekerja yang sedang bekerja tanpa penanggung jawab efektif. */
export const unassignedWorkers = <T extends { status: "ACTIVE" | "ENDED"; responsibleId: string | null }>(workers: T[]): T[] => workers.filter((w) => w.status === "ACTIVE" && !w.responsibleId);
