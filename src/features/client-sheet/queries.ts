// Pemuat data lembar klien (langkah 6). Semua lewat sesi tenant TSK (RLS): perusahaan/job order TSK lain atau dari LPK tidak terbaca (null -> 404).
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { clientCompanies, clientSiteContacts, clientSiteFields, clientSites, jobOrders, skillFields } from "@/db/schema";
import { selectedCounts } from "@/features/job-orders/queries";
import type { CompanySheetData, JobOrderSheetData, SheetSite } from "@/lib/pdf/client-sheet-model";

type SiteRow = typeof clientSites.$inferSelect;

async function sitesWithContacts(tx: Tx, rows: SiteRow[]): Promise<Array<SheetSite & { id: string }>> {
  if (rows.length === 0) return [];
  const contacts = await tx
    .select()
    .from(clientSiteContacts)
    .where(and(inArray(clientSiteContacts.siteId, rows.map((r) => r.id)), eq(clientSiteContacts.active, true)))
    .orderBy(asc(clientSiteContacts.createdAt), asc(clientSiteContacts.id));
  return rows.map((s) => ({
    id: s.id, name: s.name, address: s.address, phone: s.phone, accessNote: s.accessNote, note: s.note,
    contacts: contacts.filter((c) => c.siteId === s.id).map((c) => ({ roleTitle: c.roleTitle, name: c.name, phone: c.phone })),
  }));
}

/** Profil klien. `siteId` (opsional) membatasi ke satu lokasi (tombol di halaman lokasi): hanya lokasi dan lowongan itu. */
export async function loadCompanySheet(tx: Tx, companyId: string, siteId?: string): Promise<CompanySheetData | null> {
  const [company] = await tx.select().from(clientCompanies).where(eq(clientCompanies.id, companyId)).limit(1);
  if (!company) return null;
  const siteRows = await tx
    .select()
    .from(clientSites)
    .where(and(eq(clientSites.companyId, companyId), eq(clientSites.active, true), siteId ? eq(clientSites.id, siteId) : undefined))
    .orderBy(asc(clientSites.name), asc(clientSites.id));
  if (siteId && siteRows.length === 0) return null;
  const sites = await sitesWithContacts(tx, siteRows);
  const ids = siteRows.map((s) => s.id);
  const fields = ids.length
    ? await tx
        .selectDistinct({ id: skillFields.id, nameJa: skillFields.nameJa, sortOrder: skillFields.sortOrder })
        .from(clientSiteFields)
        .innerJoin(skillFields, eq(skillFields.id, clientSiteFields.fieldId))
        .where(inArray(clientSiteFields.siteId, ids))
        .orderBy(asc(skillFields.sortOrder), asc(skillFields.id))
    : [];
  const open = ids.length
    ? await tx
        .select({ jo: jobOrders, fieldNameJa: skillFields.nameJa })
        .from(jobOrders)
        .innerJoin(skillFields, eq(skillFields.id, jobOrders.fieldId))
        .where(and(inArray(jobOrders.siteId, ids), eq(jobOrders.status, "OPEN")))
        .orderBy(asc(jobOrders.applicationDeadline), asc(jobOrders.id))
    : [];
  const counts = await selectedCounts(tx, open.map((o) => o.jo.id));
  return {
    company: {
      name: company.name, hqAddress: company.hqAddress, industry: company.industry, employeeCount: company.employeeCount,
      foreignWorkerExperience: company.foreignWorkerExperience, publicIntro: company.publicIntro, note: company.note,
    },
    fieldNames: fields.map((f) => f.nameJa),
    sites: sites.map(({ id: _id, ...s }) => s),
    openings: open.map((o) => ({
      fieldName: o.fieldNameJa, remaining: Math.max(0, o.jo.positions - (counts.get(o.jo.id) ?? 0)), minJlpt: o.jo.minJlpt, jftRequired: o.jo.jftRequired,
      targetStartDate: o.jo.targetStartDate, applicationDeadline: o.jo.applicationDeadline, genderRequirement: o.jo.genderRequirement,
    })),
  };
}

export async function loadJobOrderSheet(tx: Tx, jobOrderId: string): Promise<JobOrderSheetData | null> {
  const [row] = await tx
    .select({ jo: jobOrders, site: clientSites, companyName: clientCompanies.name, fieldNameJa: skillFields.nameJa })
    .from(jobOrders)
    .innerJoin(clientSites, eq(clientSites.id, jobOrders.siteId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .innerJoin(skillFields, eq(skillFields.id, jobOrders.fieldId))
    .where(eq(jobOrders.id, jobOrderId))
    .limit(1);
  if (!row) return null;
  const [site] = await sitesWithContacts(tx, [row.site]);
  const j = row.jo;
  return {
    companyName: row.companyName,
    site: { name: site.name, address: site.address, phone: site.phone, accessNote: site.accessNote, note: site.note, contacts: site.contacts },
    fieldName: row.fieldNameJa,
    jo: {
      title: j.title, positions: j.positions, description: j.description, workHours: j.workHours, daysOff: j.daysOff, monthlySalary: j.monthlySalary, salaryNote: j.salaryNote,
      housing: j.housing, housingNote: j.housingNote, commuteNote: j.commuteNote, benefitsNote: j.benefitsNote, minJlpt: j.minJlpt, jftRequired: j.jftRequired,
      targetStartDate: j.targetStartDate, applicationDeadline: j.applicationDeadline, genderRequirement: j.genderRequirement, workPlace: j.workPlace, note: j.note,
    },
  };
}
