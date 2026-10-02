// Query riwayat aktivitas (audit_logs). Semua berjalan di dalam withTenant: RLS membatasi baris (hanya LPK_ADMIN/TSK_ADMIN; log organisasi sendiri
// atau yang pelakunya organisasi sendiri). Dipakai halaman Riwayat, tab di detail kandidat, widget dashboard, dan ekspor CSV.
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Tx } from "./index";
import { auditLogs } from "./schema";
import { ACTIONS, AUDIT_CATEGORIES, type AuditCategory, type AuditView } from "./audit-describe";

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_EXPORT_MAX = 5000;

export type AuditFilters = { category: AuditCategory | ""; from: string; to: string; candidateId: string; page: number };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Baca filter dari URL. Nilai asing diabaikan (bukan error). */
export function parseAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const category = one(sp.category);
  const page = Number.parseInt(one(sp.page), 10);
  return {
    category: (AUDIT_CATEGORIES as readonly string[]).includes(category) ? (category as AuditCategory) : "",
    from: YMD.test(one(sp.from)) ? one(sp.from) : "",
    to: YMD.test(one(sp.to)) ? one(sp.to) : "",
    candidateId: UUID.test(one(sp.candidate)) ? one(sp.candidate) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function where(f: Omit<AuditFilters, "page">, tz: string): SQL | undefined {
  const parts: SQL[] = [];
  if (f.category) parts.push(inArray(auditLogs.action, Object.entries(ACTIONS).filter(([, d]) => d.category === f.category).map(([k]) => k)));
  if (f.candidateId) parts.push(eq(auditLogs.candidateId, f.candidateId));
  // Batas tanggal menurut zona waktu ORGANISASI (hari itu 00:00 sampai hari berikutnya 00:00 di zona tersebut)
  if (f.from) parts.push(sql`${auditLogs.createdAt} >= (${f.from}::date)::timestamp AT TIME ZONE ${tz}`);
  if (f.to) parts.push(sql`${auditLogs.createdAt} < ((${f.to}::date + 1)::timestamp AT TIME ZONE ${tz})`);
  return parts.length ? and(...parts) : undefined;
}

const cols = {
  id: auditLogs.id,
  createdAt: auditLogs.createdAt,
  action: auditLogs.action,
  entity: auditLogs.entity,
  entityId: auditLogs.entityId,
  candidateId: auditLogs.candidateId,
  before: auditLogs.before,
  after: auditLogs.after,
  actorName: auditLogs.actorName,
  actorRole: auditLogs.actorRole,
  actorOrgName: auditLogs.actorOrgName,
  actorOrgId: auditLogs.actorOrgId,
  organizationId: auditLogs.organizationId,
};
const asView = (r: Record<string, unknown>) => r as unknown as AuditView;

export async function listAudit(tx: Tx, f: AuditFilters, tz: string): Promise<{ rows: AuditView[]; total: number }> {
  const w = where(f, tz);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(w);
  const rows = await tx.select(cols).from(auditLogs).where(w).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(AUDIT_PAGE_SIZE).offset((f.page - 1) * AUDIT_PAGE_SIZE);
  return { rows: rows.map(asView), total: n };
}

/** Entri terbaru (widget dashboard). */
export async function recentAudit(tx: Tx, n = 6): Promise<AuditView[]> {
  return (await tx.select(cols).from(auditLogs).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(n)).map(asView);
}

/** Untuk ekspor CSV: semua baris yang cocok (dibatasi AUDIT_EXPORT_MAX). */
export async function exportAudit(tx: Tx, f: Omit<AuditFilters, "page">, tz: string): Promise<AuditView[]> {
  return (await tx.select(cols).from(auditLogs).where(where(f, tz)).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(AUDIT_EXPORT_MAX)).map(asView);
}

/** Riwayat satu kandidat (tab di halaman detail). */
export async function candidateAudit(tx: Tx, candidateId: string, n = 50): Promise<AuditView[]> {
  return (await tx.select(cols).from(auditLogs).where(eq(auditLogs.candidateId, candidateId)).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(n)).map(asView);
}
