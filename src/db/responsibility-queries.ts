// Kueri penanggung jawab pekerja (T-010). Semua di dalam withTenant (RLS: hanya staf TSK organisasi sesi). SATU sumber untuk halaman, KPI dashboard, dan verify:seed.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "./index";
import { clientCompanies, responsibleAssignments, users } from "./schema";
import { allWorkers, type ActiveWorker } from "./records-queries";
import { effectiveResponsible, unassignedWorkers, workloadByStaff, type AssignmentRow, type EffectiveResponsible, type WorkloadLevel } from "./responsibility";

export type StaffRef = { id: string; name: string; role: string };
export type WorkerWithResponsible = ActiveWorker & { responsible: EffectiveResponsible };
export type HistoryEntry = { id: string; scope: "company" | "placement"; targetId: string; staffId: string | null; effectiveFrom: string; createdAt: Date; createdBy: string };

export async function listResponsibleStaff(tx: Tx): Promise<StaffRef[]> {
  return tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(inArray(users.role, ["TSK_ADMIN", "TSK_STAFF"]), eq(users.active, true))).orderBy(asc(users.name));
}

/** Seluruh riwayat penetapan (append-only), dikelompokkan per perusahaan dan per penempatan. */
export async function loadAssignments(tx: Tx) {
  const rows = await tx.select().from(responsibleAssignments).orderBy(desc(responsibleAssignments.createdAt));
  const byCompany = new Map<string, AssignmentRow[]>();
  const byPlacement = new Map<string, AssignmentRow[]>();
  const history: HistoryEntry[] = [];
  for (const r of rows) {
    const a: AssignmentRow = { staffId: r.staffId, effectiveFrom: r.effectiveFrom, createdAt: r.createdAt.toISOString() };
    if (r.companyId) byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), a]);
    if (r.placementId) byPlacement.set(r.placementId, [...(byPlacement.get(r.placementId) ?? []), a]);
    history.push({ id: r.id, scope: r.companyId ? "company" : "placement", targetId: (r.companyId ?? r.placementId)!, staffId: r.staffId, effectiveFrom: r.effectiveFrom, createdAt: r.createdAt, createdBy: r.createdBy });
  }
  return { byCompany, byPlacement, history };
}

/** Semua pekerja (ACTIVE dan ENDED) beserta penanggung jawab efektifnya pada `today`. */
export async function workersWithResponsible(tx: Tx, today: string): Promise<{ workers: WorkerWithResponsible[]; assignments: Awaited<ReturnType<typeof loadAssignments>> }> {
  const [workers, assignments] = await Promise.all([allWorkers(tx), loadAssignments(tx)]);
  return {
    assignments,
    workers: workers.map((w) => ({ ...w, responsible: effectiveResponsible(assignments.byPlacement.get(w.placementId) ?? [], assignments.byCompany.get(w.companyId) ?? [], today) })),
  };
}

export type ResponsibilityOverview = {
  staff: StaffRef[];
  workers: WorkerWithResponsible[];
  workload: Array<{ staff: StaffRef; count: number; level: WorkloadLevel }>;
  unassigned: WorkerWithResponsible[];
  /** staf yang melebihi batas (> 50): dasar KPI dashboard TSK_ADMIN */
  overLimit: StaffRef[];
  assignments: Awaited<ReturnType<typeof loadAssignments>>;
};

/** Gambaran lengkap: beban per staf, pekerja tanpa penanggung jawab, dan staf yang melebihi batas. KPI dashboard dan daftar halaman memakai fungsi INI. */
export async function responsibilityOverview(tx: Tx, today: string): Promise<ResponsibilityOverview> {
  const [staff, { workers, assignments }] = await Promise.all([listResponsibleStaff(tx), workersWithResponsible(tx, today)]);
  const byId = new Map(staff.map((s) => [s.id, s]));
  const workload = workloadByStaff(workers.map((w) => ({ status: w.status, responsibleId: w.responsible.staffId })), staff.map((s) => s.id))
    .map((x) => ({ staff: byId.get(x.staffId)!, count: x.count, level: x.level }))
    .sort((a, b) => b.count - a.count || a.staff.name.localeCompare(b.staff.name));
  return { staff, workers, workload, unassigned: unassignedWorkers(workers.map((w) => ({ ...w, responsibleId: w.responsible.staffId }))) as WorkerWithResponsible[], overLimit: workload.filter((x) => x.level === "over").map((x) => x.staff), assignments };
}

export async function companiesBasic(tx: Tx) {
  return tx.select({ id: clientCompanies.id, name: clientCompanies.name, active: clientCompanies.active }).from(clientCompanies).orderBy(asc(clientCompanies.name));
}

/** Penanggung jawab efektif SATU pekerja (nama + sumber), atau null bila bukan pekerja (tanpa penempatan). */
export async function responsibleOfWorker(tx: Tx, candidateId: string, today: string): Promise<{ staffId: string | null; name: string | null; source: "placement" | "company" | "none"; isMe?: never } | null> {
  const [{ workers }, staff] = await Promise.all([workersWithResponsible(tx, today), listResponsibleStaff(tx)]);
  const w = workers.find((x) => x.id === candidateId);
  if (!w) return null;
  return { staffId: w.responsible.staffId, name: staff.find((s) => s.id === w.responsible.staffId)?.name ?? null, source: w.responsible.source };
}
