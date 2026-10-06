// Query Catatan kegiatan yang dipakai lebih dari satu tempat (halaman, dashboard, lencana sidebar, verify:seed). Semua di dalam withTenant:
// RLS membatasi ke staf TSK organisasi sesi.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "./index";
import {
  activityCases, activityDailyReportRecipients, activityDailyReports, activityFollowups, activityRecordReads, activityRecords, candidates,
  clientCompanies, clientSiteContacts, clientSites, periodicInterviews, placements, skillFields,
} from "./schema";
import { FISCAL_QUARTERS, fiscalQuarterRange, fiscalYearOf, quarterState, workedInFiscalYear, type QuarterState, type WorkSpan } from "./records-core";

export type WorkerStatus = "ACTIVE" | "ENDED";
export type ActiveWorker = {
  id: string;
  fullName: string;
  nameKatakana: string | null;
  fieldNameId: string | null;
  fieldNameJa: string | null;
  /** Mulai kerja pada penempatan yang ditampilkan (ACTIVE bila ada, jika tidak yang berhenti paling akhir). */
  startDate: string;
  /** "ACTIVE" = masih bekerja; "ENDED" = penempatan terakhirnya sudah berhenti. */
  status: WorkerStatus;
  /** Tanggal berhenti (hanya ENDED). */
  endDate: string | null;
  /** SEMUA masa kerja pekerja ini (beberapa penempatan bila pernah berhenti lalu bekerja lagi): dasar aturan kuartal 定期面談. */
  spans: WorkSpan[];
  siteId: string;
  siteName: string;
  sitePhone: string | null;
  siteAddress: string | null;
  companyId: string;
  companyName: string;
  contacts: Array<{ name: string; phone: string | null; roleTitle: string | null }>;
};

/**
 * Semua pekerja yang PERNAH ditempatkan: penempatan ACTIVE dan ENDED (penempatan dibuat otomatis saat keputusan DEPARTED). Satu baris per pekerja:
 * yang masih bekerja lebih dulu (urut nama), lalu yang sudah berhenti (berhenti terbaru dulu). Dipakai grid/laporan 定期面談 dan pemilih pekerja (T-008).
 */
export async function allWorkers(tx: Tx): Promise<ActiveWorker[]> {
  const rows = await tx
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      nameKatakana: candidates.nameKatakana,
      fieldNameId: skillFields.nameId,
      fieldNameJa: skillFields.nameJa,
      startDate: placements.startDate,
      endDate: placements.endDate,
      status: placements.status,
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
    .where(inArray(placements.status, ["ACTIVE", "ENDED"]))
    .orderBy(asc(candidates.fullName), desc(placements.startDate));
  const contacts = await tx.select({ siteId: clientSiteContacts.siteId, name: clientSiteContacts.name, phone: clientSiteContacts.phone, roleTitle: clientSiteContacts.roleTitle }).from(clientSiteContacts).where(eq(clientSiteContacts.active, true)).orderBy(asc(clientSiteContacts.createdAt));
  const byWorker = new Map<string, typeof rows>();
  for (const r of rows) byWorker.set(r.id, [...(byWorker.get(r.id) ?? []), r]);
  const out: ActiveWorker[] = [];
  for (const list of byWorker.values()) {
    const shown = list.find((r) => r.status === "ACTIVE") ?? list[0]; // list urut start_date menurun: yang terbaru
    const status: WorkerStatus = list.some((r) => r.status === "ACTIVE") ? "ACTIVE" : "ENDED";
    out.push({
      id: shown.id, fullName: shown.fullName, nameKatakana: shown.nameKatakana, fieldNameId: shown.fieldNameId, fieldNameJa: shown.fieldNameJa,
      startDate: shown.startDate, status, endDate: status === "ENDED" ? (shown.endDate ?? null) : null,
      spans: list.map((r) => ({ start: r.startDate, end: r.status === "ACTIVE" ? null : (r.endDate ?? r.startDate) })),
      siteId: shown.siteId, siteName: shown.siteName, sitePhone: shown.sitePhone, siteAddress: shown.siteAddress, companyId: shown.companyId, companyName: shown.companyName,
      contacts: contacts.filter((c) => c.siteId === shown.siteId).map(({ name, phone, roleTitle }) => ({ name, phone, roleTitle })),
    });
  }
  return out.sort((a, b) => (a.status === b.status ? (a.status === "ACTIVE" ? a.fullName.localeCompare(b.fullName) : (b.endDate ?? "").localeCompare(a.endDate ?? "") || a.fullName.localeCompare(b.fullName)) : a.status === "ACTIVE" ? -1 : 1));
}

/** Pekerja aktif = penempatan ACTIVE saja. */
export async function activeWorkers(tx: Tx): Promise<ActiveWorker[]> {
  return (await allWorkers(tx)).filter((w) => w.status === "ACTIVE");
}

export type IntervalRow = { candidateId: string; month: string; applicable: boolean; resultStatus: string | null; interviewDate: string | null; date: string; id: string };

/** Wawancara aktif yang tanggal efektifnya (tanggal wawancara, atau awal bulan periode) jatuh di tahun fiskal itu. */
export async function interviewsOfFiscalYear(tx: Tx, fy: number): Promise<IntervalRow[]> {
  const first = `${fy}-04-01`;
  const last = `${fy + 1}-03-31`;
  const rows = await tx
    .select({ id: periodicInterviews.id, candidateId: periodicInterviews.candidateId, month: periodicInterviews.periodMonth, applicable: periodicInterviews.applicable, resultStatus: periodicInterviews.resultStatus, interviewDate: periodicInterviews.interviewDate })
    .from(periodicInterviews)
    .where(and(eq(periodicInterviews.status, "active"), sql`coalesce(${periodicInterviews.interviewDate}, ${periodicInterviews.periodMonth}) between ${first}::date and ${last}::date`));
  return rows.map((r) => ({ ...r, date: r.interviewDate ?? r.month }));
}

export type QuarterCell = { q: 1 | 2 | 3 | 4; state: QuarterState; /** wawancara selesai di kuartal ini */ count: number };
export type WorkerQuarters = { worker: ActiveWorker; quarters: QuarterCell[] };

/** Keadaan 4 kuartal untuk pekerja-pekerja pada tahun fiskal `fy` (hanya pekerja yang bekerja minimal satu hari di FY itu: ACTIVE dan ENDED). SATU sumber untuk grid, KPI, dan daftar laporan tahunan. */
export async function quartersOfFiscalYear(tx: Tx, fy: number, today: string): Promise<WorkerQuarters[]> {
  const [workers, rows] = await Promise.all([allWorkers(tx), interviewsOfFiscalYear(tx, fy)]);
  const byWorker = new Map<string, IntervalRow[]>();
  for (const r of rows) byWorker.set(r.candidateId, [...(byWorker.get(r.candidateId) ?? []), r]);
  return workers
    .filter((w) => workedInFiscalYear(w.spans, fy))
    .map((worker) => {
      const mine = (byWorker.get(worker.id) ?? []).map((r) => ({ applicable: r.applicable, resultStatus: r.resultStatus, date: r.date }));
      return {
        worker,
        quarters: FISCAL_QUARTERS.map((q) => {
          const range = fiscalQuarterRange(fy, q);
          const count = mine.filter((i) => i.applicable && i.resultStatus && i.resultStatus !== "not_done" && i.date >= range.start && i.date <= range.end).length;
          return { q, state: quarterState(fy, q, mine, today, worker.spans), count };
        }),
      };
    });
}

/**
 * Kuartal "Belum" (🔴) pada tahun fiskal berjalan: pekerja yang bekerja di FY itu (termasuk yang sudah berhenti) x kuartal wajib yang sudah berjalan/lewat tanpa wawancara selesai.
 * SATU fungsi dipakai KPI dashboard dan filter `?view=pending` pada grid (jumlah selalu sama).
 */
export async function pendingInterviewQuarters(tx: Tx, today: string): Promise<Array<{ candidateId: string; fy: number; quarter: 1 | 2 | 3 | 4 }>> {
  const fy = fiscalYearOf(today);
  const out: Array<{ candidateId: string; fy: number; quarter: 1 | 2 | 3 | 4 }> = [];
  for (const { worker, quarters } of await quartersOfFiscalYear(tx, fy, today)) for (const c of quarters) if (c.state === "pending") out.push({ candidateId: worker.id, fy, quarter: c.q });
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
