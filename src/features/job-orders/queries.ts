import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { clientCompanies, clientSiteFields, clientSites, jobOrders, skillFields, type JobOrderStatus } from "@/db/schema";

const like = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/** Keputusan yang menghitung sebagai "terpilih" untuk job order (eksplisit; sama dengan job_order_sync_status di database). */
export const SELECTED_DECISIONS = ["PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"] as const;

/** Jumlah kandidat terpilih per job order (satu kandidat dihitung sekali). */
export async function selectedCounts(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const res = await tx.execute(sql`
    select s.job_order_id::text as id, count(distinct s.candidate_id)::int as n
    from candidate_selections s
    where s.job_order_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
      and s.decision in ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED')
    group by s.job_order_id`);
  return new Map((res.rows as Array<{ id: string; n: number }>).map((r) => [r.id, r.n]));
}

export async function listJobOrders(tx: Tx, opts: { status?: JobOrderStatus | ""; q?: string }) {
  const q = opts.q?.trim();
  const rows = await tx
    .select({
      id: jobOrders.id,
      title: jobOrders.title,
      status: jobOrders.status,
      positions: jobOrders.positions,
      program: jobOrders.program,
      applicationDeadline: jobOrders.applicationDeadline,
      targetStartDate: jobOrders.targetStartDate,
      siteId: clientSites.id,
      siteName: clientSites.name,
      companyId: clientCompanies.id,
      companyName: clientCompanies.name,
      fieldNameId: skillFields.nameId,
      fieldNameJa: skillFields.nameJa,
    })
    .from(jobOrders)
    .innerJoin(clientSites, eq(clientSites.id, jobOrders.siteId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .innerJoin(skillFields, eq(skillFields.id, jobOrders.fieldId))
    .where(
      and(
        opts.status ? eq(jobOrders.status, opts.status) : undefined,
        q ? or(ilike(jobOrders.title, like(q)), ilike(clientCompanies.name, like(q)), ilike(clientSites.name, like(q))) : undefined,
      ),
    )
    .orderBy(asc(jobOrders.status), desc(jobOrders.createdAt), asc(jobOrders.id));
  const counts = await selectedCounts(tx, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, selected: counts.get(r.id) ?? 0 }));
}
export type JobOrderListItem = Awaited<ReturnType<typeof listJobOrders>>[number];

export async function getJobOrder(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      jo: jobOrders,
      siteName: clientSites.name,
      siteActive: clientSites.active,
      companyId: clientCompanies.id,
      companyName: clientCompanies.name,
      fieldNameId: skillFields.nameId,
      fieldNameJa: skillFields.nameJa,
    })
    .from(jobOrders)
    .innerJoin(clientSites, eq(clientSites.id, jobOrders.siteId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .innerJoin(skillFields, eq(skillFields.id, jobOrders.fieldId))
    .where(eq(jobOrders.id, id))
    .limit(1);
  if (!row) return null;
  const siteFieldIds = (await tx.select({ f: clientSiteFields.fieldId }).from(clientSiteFields).where(eq(clientSiteFields.siteId, row.jo.siteId))).map((r) => r.f);
  const selected = (await selectedCounts(tx, [id])).get(id) ?? 0;
  return { ...row, siteFieldIds, selected };
}

/** Lokasi aktif (perusahaan aktif) beserta bidang yang diterima: pilihan saat membuat job order. */
export async function listSiteOptions(tx: Tx) {
  const sites = await tx
    .select({ id: clientSites.id, name: clientSites.name, companyName: clientCompanies.name })
    .from(clientSites)
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .where(and(eq(clientSites.active, true), eq(clientCompanies.active, true)))
    .orderBy(asc(clientCompanies.name), asc(clientSites.name));
  const fields = sites.length ? await tx.select().from(clientSiteFields).where(inArray(clientSiteFields.siteId, sites.map((s) => s.id))) : [];
  return sites.map((s) => ({ ...s, fieldIds: fields.filter((f) => f.siteId === s.id).map((f) => f.fieldId) }));
}

/** Job order TSK ini yang bidangnya sama dengan kandidat: pilihan "untuk job order" di form keputusan. */
export async function jobOrderOptionsForField(tx: Tx, fieldId: string | null) {
  if (!fieldId) return [];
  return tx
    .select({ id: jobOrders.id, title: jobOrders.title, status: jobOrders.status, siteName: clientSites.name, companyName: clientCompanies.name })
    .from(jobOrders)
    .innerJoin(clientSites, eq(clientSites.id, jobOrders.siteId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .where(eq(jobOrders.fieldId, fieldId))
    .orderBy(asc(jobOrders.status), asc(clientCompanies.name), asc(jobOrders.title));
}

/** Job order di satu lokasi (untuk halaman lokasi). */
export async function jobOrdersForSite(tx: Tx, siteId: string) {
  return tx.select({ id: jobOrders.id, title: jobOrders.title, status: jobOrders.status }).from(jobOrders).where(eq(jobOrders.siteId, siteId)).orderBy(asc(jobOrders.status), desc(jobOrders.createdAt));
}
