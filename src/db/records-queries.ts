// Query Catatan kegiatan yang dipakai lebih dari satu tempat (halaman, dashboard, lencana sidebar, verify:seed). Semua di dalam withTenant:
// RLS membatasi ke staf TSK organisasi sesi.
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "./index";
import {
  activityCases, activityDailyReportRecipients, activityDailyReports, activityFollowups, activityRecordReads, activityRecords, candidates,
  clientCompanies, clientSiteContacts, clientSites, periodicInterviews, placements, skillFields,
} from "./schema";
import { cellState, fiscalMonths, fiscalYearOf } from "./records-core";

export type ActiveWorker = {
  id: string;
  fullName: string;
  nameKatakana: string | null;
  fieldNameId: string | null;
  fieldNameJa: string | null;
  startDate: string;
  siteId: string;
  siteName: string;
  sitePhone: string | null;
  siteAddress: string | null;
  companyId: string;
  companyName: string;
  contacts: Array<{ name: string; phone: string | null; roleTitle: string | null }>;
};

/** Pekerja aktif = placement ACTIVE (dibuat otomatis saat keputusan DEPARTED). */
export async function activeWorkers(tx: Tx): Promise<ActiveWorker[]> {
  const rows = await tx
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      nameKatakana: candidates.nameKatakana,
      fieldNameId: skillFields.nameId,
      fieldNameJa: skillFields.nameJa,
      startDate: placements.startDate,
      siteId: clientSites.id,
      siteName: clientSites.name,
      sitePhone: clientSites.phone,
      siteAddress: clientSites.address,
      companyId: clientCompanies.id,
      companyName: clientCompanies.name,
    })
    .from(placements)
    .innerJoin(candidates, eq(candidates.id, placements.candidateId))
    .innerJoin(clientSites, eq(clientSites.id, placements.siteId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .leftJoin(skillFields, eq(skillFields.id, candidates.fieldId))
    .where(eq(placements.status, "ACTIVE"))
    .orderBy(asc(candidates.fullName));
  const contacts = await tx.select({ siteId: clientSiteContacts.siteId, name: clientSiteContacts.name, phone: clientSiteContacts.phone, roleTitle: clientSiteContacts.roleTitle }).from(clientSiteContacts).where(eq(clientSiteContacts.active, true)).orderBy(asc(clientSiteContacts.createdAt));
  return rows.map((r) => ({ ...r, contacts: contacts.filter((c) => c.siteId === r.siteId).map(({ name, phone, roleTitle }) => ({ name, phone, roleTitle })) }));
}

export type IntervalRow = { candidateId: string; month: string; applicable: boolean; resultStatus: string | null; interviewDate: string | null; id: string };

export async function interviewsOfFiscalYear(tx: Tx, fy: number): Promise<IntervalRow[]> {
  const months = fiscalMonths(fy);
  const rows = await tx
    .select({ id: periodicInterviews.id, candidateId: periodicInterviews.candidateId, month: periodicInterviews.periodMonth, applicable: periodicInterviews.applicable, resultStatus: periodicInterviews.resultStatus, interviewDate: periodicInterviews.interviewDate })
    .from(periodicInterviews)
    .where(and(eq(periodicInterviews.status, "active"), sql`${periodicInterviews.periodMonth} >= ${months[0]}::date and ${periodicInterviews.periodMonth} <= ${months[11]}::date`));
  return rows;
}

/**
 * Sel "Belum" (🔴) pada tahun fiskal berjalan: per pekerja aktif, bulan sejak mulai kerja sampai bulan berjalan tanpa wawancara selesai.
 * SATU fungsi dipakai KPI dashboard dan filter grid (jumlah selalu sama).
 */
export async function pendingInterviewCells(tx: Tx, today: string): Promise<Array<{ candidateId: string; month: string }>> {
  const fy = fiscalYearOf(today);
  const [workers, rows] = await Promise.all([activeWorkers(tx), interviewsOfFiscalYear(tx, fy)]);
  const byKey = new Map(rows.map((r) => [`${r.candidateId}|${r.month}`, r]));
  const out: Array<{ candidateId: string; month: string }> = [];
  for (const w of workers) {
    for (const month of fiscalMonths(fy)) {
      if (cellState(month, byKey.get(`${w.id}|${month}`), today, w.startDate) === "pending") out.push({ candidateId: w.id, month });
    }
  }
  return out;
}

/** Id catatan aktif yang belum kubaca (bukan tulisanku; tanda baca belum ada atau versinya sudah lebih baru). */
export async function unreadRecordIds(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: activityRecords.id })
    .from(activityRecords)
    .leftJoin(activityRecordReads, and(eq(activityRecordReads.recordId, activityRecords.id), eq(activityRecordReads.userId, userId)))
    .where(and(eq(activityRecords.status, "active"), ne(activityRecords.authorId, userId), sql`(${activityRecordReads.recordId} is null or ${activityRecordReads.versionNoRead} < ${activityRecords.versionNo})`));
  return rows.map((r) => r.id);
}

/**
 * Laporan harian staf lain yang dikirim kepadaku dan belum kubaca ATAU diperbarui sejak kubaca (dikirim ulang, ① baru ditambahkan, atau ① diedit
 * setelah waktu baca). SATU definisi: dipakai KPI dashboard, lencana sidebar, dan daftar "Laporan harian staf" (jumlahnya selalu sama).
 */
export async function unreadReportIds(tx: Tx, userId: string): Promise<string[]> {
  const res = await tx.execute(sql`
    select d.id::text as id
    from activity_daily_report_recipients rr
    join activity_daily_reports d on d.id = rr.report_id
    where rr.user_id = ${userId}::uuid and d.shared_at is not null
      and (
        rr.read_at is null
        or rr.read_shared_at is null or rr.read_shared_at < d.shared_at
        or exists (
          select 1 from activity_records r
          where r.kind = 'daily_work' and r.status = 'active' and r.author_id = d.author_id and r.record_date = d.report_date
            and (r.created_at > rr.read_at or (r.version_no > 1 and r.updated_at > rr.read_at))
        )
      )`);
  return (res.rows as Array<{ id: string }>).map((r) => r.id);
}

export async function followupIds(tx: Tx, opts: { userId?: string; status?: "open" }): Promise<string[]> {
  const rows = await tx
    .select({ id: activityFollowups.id })
    .from(activityFollowups)
    .where(and(eq(activityFollowups.status, opts.status ?? "open"), opts.userId ? eq(activityFollowups.assigneeId, opts.userId) : undefined));
  return rows.map((r) => r.id);
}

export async function openCases(tx: Tx, n = 100) {
  return tx.select({ id: activityCases.id, code: activityCases.code, title: activityCases.title, category: activityCases.category, openedAt: activityCases.openedAt }).from(activityCases).where(eq(activityCases.status, "open")).orderBy(desc(activityCases.openedAt)).limit(n);
}

export const noVoid = (col: typeof activityRecords.status) => eq(col, "active");
export { isNull };
