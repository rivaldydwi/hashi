import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import type { Tx } from "@/db";
import { clientCompanies, clientSiteContacts, clientSiteFields, clientSites, skillFields } from "@/db/schema";

const like = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/** Daftar perusahaan (法人) dengan lokasinya dan bidang yang diterima tiap lokasi. Pencarian: nama perusahaan, nama alternatif, atau nama lokasi. */
export async function listCompanies(tx: Tx, opts: { q?: string; includeInactive?: boolean }) {
  const q = opts.q?.trim();
  let ids: string[] | null = null;
  if (q) {
    const hit = await tx
      .selectDistinct({ id: clientCompanies.id })
      .from(clientCompanies)
      .leftJoin(clientSites, eq(clientSites.companyId, clientCompanies.id))
      .where(or(ilike(clientCompanies.name, like(q)), ilike(clientCompanies.nameAlt, like(q)), ilike(clientSites.name, like(q))));
    ids = hit.map((r) => r.id);
    if (ids.length === 0) return [];
  }
  const companies = await tx
    .select()
    .from(clientCompanies)
    .where(and(opts.includeInactive ? undefined : eq(clientCompanies.active, true), ids ? inArray(clientCompanies.id, ids) : undefined))
    .orderBy(asc(clientCompanies.name), asc(clientCompanies.id));
  if (companies.length === 0) return [];
  const sites = await tx
    .select()
    .from(clientSites)
    .where(and(inArray(clientSites.companyId, companies.map((c) => c.id)), opts.includeInactive ? undefined : eq(clientSites.active, true)))
    .orderBy(asc(clientSites.name), asc(clientSites.id));
  const fieldRows = sites.length
    ? await tx
        .select({ siteId: clientSiteFields.siteId, fieldId: clientSiteFields.fieldId })
        .from(clientSiteFields)
        .where(inArray(clientSiteFields.siteId, sites.map((s) => s.id)))
    : [];
  const fieldsBySite = new Map<string, string[]>();
  for (const f of fieldRows) fieldsBySite.set(f.siteId, [...(fieldsBySite.get(f.siteId) ?? []), f.fieldId]);
  return companies.map((c) => ({
    ...c,
    sites: sites.filter((s) => s.companyId === c.id).map((s) => ({ ...s, fieldIds: fieldsBySite.get(s.id) ?? [] })),
  }));
}
export type CompanyListItem = Awaited<ReturnType<typeof listCompanies>>[number];

export async function getCompany(tx: Tx, id: string) {
  const [company] = await tx.select().from(clientCompanies).where(eq(clientCompanies.id, id)).limit(1);
  if (!company) return null;
  const sites = await tx.select().from(clientSites).where(eq(clientSites.companyId, id)).orderBy(asc(clientSites.name));
  return { company, sites };
}

/** Lokasi + perusahaannya + bidang yang diterima + PIC. */
export async function getSite(tx: Tx, id: string) {
  const [row] = await tx
    .select({ site: clientSites, company: clientCompanies })
    .from(clientSites)
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .where(eq(clientSites.id, id))
    .limit(1);
  if (!row) return null;
  const fields = await tx
    .select({ id: skillFields.id, nameId: skillFields.nameId, nameJa: skillFields.nameJa, active: skillFields.active })
    .from(clientSiteFields)
    .innerJoin(skillFields, eq(skillFields.id, clientSiteFields.fieldId))
    .where(eq(clientSiteFields.siteId, id))
    .orderBy(asc(skillFields.sortOrder));
  const contacts = await tx.select().from(clientSiteContacts).where(eq(clientSiteContacts.siteId, id)).orderBy(asc(clientSiteContacts.createdAt));
  return { ...row, fields, contacts };
}
export type SiteDetail = NonNullable<Awaited<ReturnType<typeof getSite>>>;
