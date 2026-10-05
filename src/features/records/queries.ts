import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  activityAttachments, activityCaseSubjects, activityCases, activityDailyReportRecipients, activityDailyReports, activityFollowups, activityRecordHandlers,
  activityRecordReads, activityRecordRecipients, activityRecordSubjects, activityRecords, activityRevisions, candidates, caseTimelineEvents,
  clientCompanies, clientSites, periodicInterviewQuarterNotes, periodicInterviews, users,
} from "@/db/schema";
import { unreadRecordIds, unreadReportIds } from "@/db/records-queries";

export { activeWorkers, pendingInterviewCells, interviewsOfFiscalYear, unreadRecordIds, unreadReportIds } from "@/db/records-queries";

export type StaffUser = { id: string; name: string; role: string };

export async function listStaff(tx: Tx): Promise<StaffUser[]> {
  return tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(inArray(users.role, ["TSK_ADMIN", "TSK_STAFF"]), eq(users.active, true))).orderBy(asc(users.name));
}

export type RecordFilters = { kind: "daily_work" | "meeting"; from: string; to: string; staff: string; worker: string; workType: string; caseId: string; unread: boolean; openTasks: boolean; page: number };
export const RECORD_PAGE_SIZE = 40;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseRecordFilters(sp: Record<string, string | string[] | undefined>, kind: RecordFilters["kind"]): RecordFilters {
  const page = Number.parseInt(one(sp.page), 10);
  return {
    kind,
    from: YMD.test(one(sp.from)) ? one(sp.from) : "",
    to: YMD.test(one(sp.to)) ? one(sp.to) : "",
    staff: UUID.test(one(sp.staff)) ? one(sp.staff) : "",
    worker: UUID.test(one(sp.worker)) ? one(sp.worker) : "",
    workType: ["interview", "consultation", "residence_card", "hospital_visit", "other"].includes(one(sp.workType)) ? one(sp.workType) : "",
    caseId: UUID.test(one(sp.case)) ? one(sp.case) : "",
    unread: one(sp.view) === "unread",
    openTasks: one(sp.tasks) === "open",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export type RecordRow = {
  id: string; kind: string; recordDate: string; status: string; versionNo: number; authorId: string; authorName: string;
  workType: string | null; workTypeOther: string | null; subject: string | null; startedAt: Date | null;
  actionTaken: string | null; caseId: string | null; caseCode: string | null;
  workers: Array<{ id: string; name: string }>; unreadForMe: boolean; staleForMe: boolean; openTasks: number; photos: number;
};

/** Daftar catatan (① atau ②) beserta pekerja, penulis, status baca untukku, tugas terbuka, dan jumlah foto. */
export async function listRecords(tx: Tx, f: RecordFilters, userId: string): Promise<{ rows: RecordRow[]; total: number }> {
  const unreadIds = f.unread ? await unreadRecordIds(tx, userId) : null;
  const conds = [
    // tampilan "belum dibaca" mencakup ① dan ② (sama dengan KPI dashboard dan lencana sidebar)
    f.unread ? undefined : eq(activityRecords.kind, f.kind),
    f.from ? gte(activityRecords.recordDate, f.from) : undefined,
    f.to ? lte(activityRecords.recordDate, f.to) : undefined,
    f.staff ? eq(activityRecords.authorId, f.staff) : undefined,
    f.workType ? eq(activityRecords.workType, f.workType) : undefined,
    f.caseId ? eq(activityRecords.caseId, f.caseId) : undefined,
    f.worker ? sql`exists (select 1 from activity_record_subjects s where s.record_id = ${activityRecords.id} and s.candidate_id = ${f.worker})` : undefined,
    f.openTasks ? sql`exists (select 1 from activity_followups t where t.record_id = ${activityRecords.id} and t.status = 'open')` : undefined,
    unreadIds ? (unreadIds.length ? inArray(activityRecords.id, unreadIds) : sql`false`) : undefined,
  ];
  const where = and(...conds);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(activityRecords).where(where);
  const base = await tx
    .select({
      id: activityRecords.id, kind: activityRecords.kind, recordDate: activityRecords.recordDate, status: activityRecords.status, versionNo: activityRecords.versionNo,
      authorId: activityRecords.authorId, authorName: users.name, workType: activityRecords.workType, workTypeOther: activityRecords.workTypeOther,
      subject: activityRecords.subject, startedAt: activityRecords.startedAt, actionTaken: activityRecords.actionTaken, caseId: activityRecords.caseId, caseCode: activityCases.code,
    })
    .from(activityRecords)
    .innerJoin(users, eq(users.id, activityRecords.authorId))
    .leftJoin(activityCases, eq(activityCases.id, activityRecords.caseId))
    .where(where)
    .orderBy(desc(activityRecords.recordDate), desc(activityRecords.createdAt))
    .limit(RECORD_PAGE_SIZE)
    .offset((f.page - 1) * RECORD_PAGE_SIZE);
  const ids = base.map((r) => r.id);
  if (ids.length === 0) return { rows: [], total: n };
  const [subs, reads, tasks, photos] = await Promise.all([
    tx.select({ recordId: activityRecordSubjects.recordId, id: candidates.id, name: candidates.fullName }).from(activityRecordSubjects).innerJoin(candidates, eq(candidates.id, activityRecordSubjects.candidateId)).where(inArray(activityRecordSubjects.recordId, ids)),
    tx.select({ recordId: activityRecordReads.recordId, v: activityRecordReads.versionNoRead }).from(activityRecordReads).where(and(eq(activityRecordReads.userId, userId), inArray(activityRecordReads.recordId, ids))),
    tx.select({ recordId: activityFollowups.recordId, n: sql<number>`count(*)::int` }).from(activityFollowups).where(and(eq(activityFollowups.status, "open"), inArray(activityFollowups.recordId, ids))).groupBy(activityFollowups.recordId),
    tx.select({ recordId: activityAttachments.recordId, n: sql<number>`count(*)::int` }).from(activityAttachments).where(and(isNull(activityAttachments.removedAt), inArray(activityAttachments.recordId, ids))).groupBy(activityAttachments.recordId),
  ]);
  const readBy = new Map(reads.map((r) => [r.recordId, r.v]));
  const rows = base.map((r) => {
    const seen = readBy.get(r.id);
    const mine = r.authorId === userId;
    return {
      ...r,
      workers: subs.filter((s) => s.recordId === r.id).map((s) => ({ id: s.id, name: s.name })),
      unreadForMe: !mine && r.status === "active" && seen === undefined,
      staleForMe: !mine && r.status === "active" && seen !== undefined && seen < r.versionNo,
      openTasks: tasks.find((t) => t.recordId === r.id)?.n ?? 0,
      photos: photos.find((p) => p.recordId === r.id)?.n ?? 0,
    };
  });
  return { rows, total: n };
}

export type RevisionRow = { id: number; versionNo: number; snapshot: Record<string, unknown>; editedAt: Date; editorName: string | null };

export async function revisionsOf(tx: Tx, type: string, id: string): Promise<RevisionRow[]> {
  const rows = await tx
    .select({ id: activityRevisions.id, versionNo: activityRevisions.versionNo, snapshot: activityRevisions.snapshot, editedAt: activityRevisions.editedAt, editorName: users.name })
    .from(activityRevisions)
    .leftJoin(users, eq(users.id, activityRevisions.editedBy))
    .where(and(eq(activityRevisions.entityType, type), eq(activityRevisions.entityId, id)))
    .orderBy(asc(activityRevisions.versionNo));
  return rows.map((r) => ({ ...r, snapshot: r.snapshot as Record<string, unknown> }));
}

export async function getRecord(tx: Tx, id: string) {
  const [rec] = await tx
    .select({ r: activityRecords, authorName: users.name, caseCode: activityCases.code, caseTitle: activityCases.title, siteName: clientSites.name, companyName: clientCompanies.name })
    .from(activityRecords)
    .innerJoin(users, eq(users.id, activityRecords.authorId))
    .leftJoin(activityCases, eq(activityCases.id, activityRecords.caseId))
    .leftJoin(clientSites, eq(clientSites.id, activityRecords.clientSiteId))
    .leftJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .where(eq(activityRecords.id, id))
    .limit(1);
  if (!rec) return null;
  const [subjects, handlers, recipients, reads, attachments, followups, revisions] = await Promise.all([
    tx.select({ id: candidates.id, name: candidates.fullName, katakana: candidates.nameKatakana }).from(activityRecordSubjects).innerJoin(candidates, eq(candidates.id, activityRecordSubjects.candidateId)).where(eq(activityRecordSubjects.recordId, id)).orderBy(asc(candidates.fullName)),
    tx.select({ id: users.id, name: users.name }).from(activityRecordHandlers).innerJoin(users, eq(users.id, activityRecordHandlers.userId)).where(eq(activityRecordHandlers.recordId, id)).orderBy(asc(users.name)),
    tx.select({ id: users.id, name: users.name }).from(activityRecordRecipients).innerJoin(users, eq(users.id, activityRecordRecipients.userId)).where(eq(activityRecordRecipients.recordId, id)).orderBy(asc(users.name)),
    tx.select({ userId: activityRecordReads.userId, name: users.name, readAt: activityRecordReads.readAt, versionNoRead: activityRecordReads.versionNoRead }).from(activityRecordReads).innerJoin(users, eq(users.id, activityRecordReads.userId)).where(eq(activityRecordReads.recordId, id)).orderBy(asc(activityRecordReads.readAt)),
    tx.select().from(activityAttachments).where(and(eq(activityAttachments.recordId, id), isNull(activityAttachments.removedAt))).orderBy(asc(activityAttachments.createdAt)),
    tx.select({ f: activityFollowups, assigneeName: users.name }).from(activityFollowups).innerJoin(users, eq(users.id, activityFollowups.assigneeId)).where(eq(activityFollowups.recordId, id)).orderBy(asc(activityFollowups.createdAt)),
    revisionsOf(tx, "record", id),
  ]);
  return { ...rec, subjects, handlers, recipients, reads, attachments, followups, revisions };
}

export type DailyReportState = {
  report: { id: string; sharedAt: Date | null } | null;
  count: number;
  recipients: Array<{ userId: string; name: string; readAt: Date | null; readSharedAt: Date | null }>;
  addedAfter: number; // ① ditambahkan setelah dikirim
  editedAfter: number; // ① diedit setelah dikirim
};

/** Laporan harian milikku untuk satu tanggal: jumlah ①, status kirim, dan penanda perubahan sesudah kirim. */
export async function myDailyReport(tx: Tx, userId: string, date: string): Promise<DailyReportState> {
  const [report] = await tx.select({ id: activityDailyReports.id, sharedAt: activityDailyReports.sharedAt }).from(activityDailyReports).where(and(eq(activityDailyReports.authorId, userId), eq(activityDailyReports.reportDate, date))).limit(1);
  const recs = await tx.select({ createdAt: activityRecords.createdAt, updatedAt: activityRecords.updatedAt, versionNo: activityRecords.versionNo }).from(activityRecords).where(and(eq(activityRecords.kind, "daily_work"), eq(activityRecords.authorId, userId), eq(activityRecords.recordDate, date), eq(activityRecords.status, "active")));
  const recipients = report
    ? await tx.select({ userId: activityDailyReportRecipients.userId, name: users.name, readAt: activityDailyReportRecipients.readAt, readSharedAt: activityDailyReportRecipients.readSharedAt }).from(activityDailyReportRecipients).innerJoin(users, eq(users.id, activityDailyReportRecipients.userId)).where(eq(activityDailyReportRecipients.reportId, report.id)).orderBy(asc(users.name))
    : [];
  const sentAt = report?.sharedAt ?? null;
  return {
    report: report ?? null,
    count: recs.length,
    recipients,
    addedAfter: sentAt ? recs.filter((r) => r.createdAt > sentAt).length : 0,
    editedAfter: sentAt ? recs.filter((r) => r.createdAt <= sentAt && r.versionNo > 1 && r.updatedAt > sentAt).length : 0,
  };
}

export type StaffReportRow = {
  id: string; authorId: string; authorName: string; reportDate: string; sharedAt: Date; readAt: Date | null; readSharedAt: Date | null;
  count: number; addedAfter: number; editedAfter: number; updatedSinceRead: boolean;
};

/** Laporan harian staf yang dikirim KEPADAKU (tampilan penerima), terbaru dulu. */
export async function reportsForMe(tx: Tx, userId: string, opts: { date?: string; unreadOnly?: boolean } = {}): Promise<StaffReportRow[]> {
  const unreadIds = opts.unreadOnly ? new Set(await unreadReportIds(tx, userId)) : null; // definisi tunggal (sama dengan KPI)
  const rows = await tx
    .select({ id: activityDailyReports.id, authorId: activityDailyReports.authorId, authorName: users.name, reportDate: activityDailyReports.reportDate, sharedAt: activityDailyReports.sharedAt, readAt: activityDailyReportRecipients.readAt, readSharedAt: activityDailyReportRecipients.readSharedAt })
    .from(activityDailyReportRecipients)
    .innerJoin(activityDailyReports, eq(activityDailyReports.id, activityDailyReportRecipients.reportId))
    .innerJoin(users, eq(users.id, activityDailyReports.authorId))
    .where(and(eq(activityDailyReportRecipients.userId, userId), sql`${activityDailyReports.sharedAt} is not null`, opts.date ? eq(activityDailyReports.reportDate, opts.date) : undefined))
    .orderBy(desc(activityDailyReports.reportDate), asc(users.name))
    .limit(60);
  const out: StaffReportRow[] = [];
  for (const r of rows) {
    const recs = await tx.select({ createdAt: activityRecords.createdAt, updatedAt: activityRecords.updatedAt, versionNo: activityRecords.versionNo }).from(activityRecords).where(and(eq(activityRecords.kind, "daily_work"), eq(activityRecords.authorId, r.authorId), eq(activityRecords.recordDate, r.reportDate), eq(activityRecords.status, "active")));
    const sent = r.sharedAt!;
    // Diperbarui sejak dibaca: laporan dikirim ulang, ① baru ditambahkan, atau ① diedit setelah waktu baca
    const updatedSinceRead = r.readAt !== null && (r.readSharedAt === null || r.readSharedAt < sent || recs.some((x) => x.createdAt > r.readAt! || (x.versionNo > 1 && x.updatedAt > r.readAt!)));
    const row: StaffReportRow = { ...r, sharedAt: sent, count: recs.length, addedAfter: recs.filter((x) => x.createdAt > sent).length, editedAfter: recs.filter((x) => x.createdAt <= sent && x.versionNo > 1 && x.updatedAt > sent).length, updatedSinceRead };
    if (!unreadIds || unreadIds.has(r.id)) out.push(row);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ Kasus
export async function listCases(tx: Tx, f: { status: string; workerId: string }) {
  const rows = await tx
    .select({ id: activityCases.id, code: activityCases.code, title: activityCases.title, category: activityCases.category, status: activityCases.status, openedAt: activityCases.openedAt, closedAt: activityCases.closedAt })
    .from(activityCases)
    .where(and(f.status === "open" || f.status === "closed" ? eq(activityCases.status, f.status) : undefined, f.workerId ? sql`exists (select 1 from activity_case_subjects s where s.case_id = ${activityCases.id} and s.candidate_id = ${f.workerId})` : undefined))
    .orderBy(desc(activityCases.openedAt))
    .limit(200);
  const ids = rows.map((r) => r.id);
  const subs = ids.length ? await tx.select({ caseId: activityCaseSubjects.caseId, name: candidates.fullName }).from(activityCaseSubjects).innerJoin(candidates, eq(candidates.id, activityCaseSubjects.candidateId)).where(inArray(activityCaseSubjects.caseId, ids)) : [];
  return rows.map((r) => ({ ...r, workers: subs.filter((s) => s.caseId === r.id).map((s) => s.name) }));
}

export async function getCase(tx: Tx, id: string) {
  const [c] = await tx.select({ c: activityCases, creatorName: users.name }).from(activityCases).innerJoin(users, eq(users.id, activityCases.createdBy)).where(eq(activityCases.id, id)).limit(1);
  if (!c) return null;
  const [subjects, events, records, followups, revisions] = await Promise.all([
    tx.select({ id: candidates.id, name: candidates.fullName, katakana: candidates.nameKatakana }).from(activityCaseSubjects).innerJoin(candidates, eq(candidates.id, activityCaseSubjects.candidateId)).where(eq(activityCaseSubjects.caseId, id)).orderBy(asc(candidates.fullName)),
    tx.select({ e: caseTimelineEvents, creatorName: users.name }).from(caseTimelineEvents).innerJoin(users, eq(users.id, caseTimelineEvents.createdBy)).where(eq(caseTimelineEvents.caseId, id)).orderBy(asc(caseTimelineEvents.occurredAt), asc(caseTimelineEvents.createdAt)),
    tx.select({ id: activityRecords.id, kind: activityRecords.kind, recordDate: activityRecords.recordDate, status: activityRecords.status, subject: activityRecords.subject, workType: activityRecords.workType, authorName: users.name }).from(activityRecords).innerJoin(users, eq(users.id, activityRecords.authorId)).where(eq(activityRecords.caseId, id)).orderBy(desc(activityRecords.recordDate)),
    tx.select({ f: activityFollowups, assigneeName: users.name }).from(activityFollowups).innerJoin(users, eq(users.id, activityFollowups.assigneeId)).where(eq(activityFollowups.caseId, id)).orderBy(asc(activityFollowups.createdAt)),
    revisionsOf(tx, "case", id),
  ]);
  return { ...c, subjects, events, records, followups, revisions };
}

export async function timelineRevisions(tx: Tx, eventIds: string[]) {
  if (eventIds.length === 0) return new Map<string, RevisionRow[]>();
  const rows = await tx
    .select({ id: activityRevisions.id, entityId: activityRevisions.entityId, versionNo: activityRevisions.versionNo, snapshot: activityRevisions.snapshot, editedAt: activityRevisions.editedAt, editorName: users.name })
    .from(activityRevisions)
    .leftJoin(users, eq(users.id, activityRevisions.editedBy))
    .where(and(eq(activityRevisions.entityType, "timeline_event"), inArray(activityRevisions.entityId, eventIds)))
    .orderBy(asc(activityRevisions.versionNo));
  const m = new Map<string, RevisionRow[]>();
  for (const r of rows) m.set(r.entityId, [...(m.get(r.entityId) ?? []), { id: r.id, versionNo: r.versionNo, snapshot: r.snapshot as Record<string, unknown>, editedAt: r.editedAt, editorName: r.editorName }]);
  return m;
}

// ------------------------------------------------------------------------------------------------ Tugas
export type TaskFilters = { scope: "mine" | "all"; status: "open" | "done" | "cancelled" | "overdue" | "" };
export function parseTaskFilters(sp: Record<string, string | string[] | undefined>): TaskFilters {
  const status = one(sp.status);
  return { scope: one(sp.scope) === "all" ? "all" : "mine", status: (["open", "done", "cancelled", "overdue"].includes(status) ? status : "open") as TaskFilters["status"] };
}
export async function listTasks(tx: Tx, f: TaskFilters, userId: string, today: string) {
  return tx
    .select({
      id: activityFollowups.id, description: activityFollowups.description, dueDate: activityFollowups.dueDate, status: activityFollowups.status, assigneeId: activityFollowups.assigneeId, createdBy: activityFollowups.createdBy,
      assigneeName: users.name, recordId: activityFollowups.recordId, caseId: activityFollowups.caseId, interviewId: activityFollowups.interviewId,
      interviewCandidateId: periodicInterviews.candidateId, interviewMonth: periodicInterviews.periodMonth,
    })
    .from(activityFollowups)
    .innerJoin(users, eq(users.id, activityFollowups.assigneeId))
    .leftJoin(periodicInterviews, eq(periodicInterviews.id, activityFollowups.interviewId))
    .where(and(
      f.scope === "mine" ? eq(activityFollowups.assigneeId, userId) : undefined,
      f.status === "overdue" ? and(eq(activityFollowups.status, "open"), sql`${activityFollowups.dueDate} < ${today}`) : f.status ? eq(activityFollowups.status, f.status) : undefined,
    ))
    .orderBy(sql`${activityFollowups.dueDate} asc nulls last`, desc(activityFollowups.createdAt))
    .limit(300);
}

// ------------------------------------------------------------------------------------------------ Wawancara berkala
export async function interviewDetail(tx: Tx, candidateId: string, month: string) {
  const [row] = await tx.select().from(periodicInterviews).where(and(eq(periodicInterviews.candidateId, candidateId), eq(periodicInterviews.periodMonth, month), eq(periodicInterviews.status, "active"))).limit(1);
  if (!row) return null;
  const [attachments, followups, revisions] = await Promise.all([
    tx.select().from(activityAttachments).where(and(eq(activityAttachments.interviewId, row.id), isNull(activityAttachments.removedAt))).orderBy(asc(activityAttachments.createdAt)),
    tx.select({ f: activityFollowups, assigneeName: users.name }).from(activityFollowups).innerJoin(users, eq(users.id, activityFollowups.assigneeId)).where(eq(activityFollowups.interviewId, row.id)),
    revisionsOf(tx, "periodic_interview", row.id),
  ]);
  return { row, attachments, followups, revisions };
}

export async function quarterNotes(tx: Tx, fy: number) {
  return tx.select({ candidateId: periodicInterviewQuarterNotes.candidateId, quarter: periodicInterviewQuarterNotes.quarter, note: periodicInterviewQuarterNotes.note }).from(periodicInterviewQuarterNotes).where(eq(periodicInterviewQuarterNotes.fiscalYear, fy));
}

export async function interviewRowsFull(tx: Tx, fy: number) {
  const rows = await tx.select().from(periodicInterviews).where(and(eq(periodicInterviews.status, "active"), sql`${periodicInterviews.periodMonth} >= ${`${fy}-04-01`}::date and ${periodicInterviews.periodMonth} <= ${`${fy + 1}-03-01`}::date`));
  return rows;
}

export async function recordsOfWorker(tx: Tx, candidateId: string, n = 20) {
  const recs = await tx
    .select({ id: activityRecords.id, kind: activityRecords.kind, recordDate: activityRecords.recordDate, status: activityRecords.status, subject: activityRecords.subject, workType: activityRecords.workType, authorName: users.name })
    .from(activityRecords)
    .innerJoin(activityRecordSubjects, eq(activityRecordSubjects.recordId, activityRecords.id))
    .innerJoin(users, eq(users.id, activityRecords.authorId))
    .where(eq(activityRecordSubjects.candidateId, candidateId))
    .orderBy(desc(activityRecords.recordDate), desc(activityRecords.createdAt))
    .limit(n);
  const cases = await tx
    .select({ id: activityCases.id, code: activityCases.code, title: activityCases.title, status: activityCases.status, category: activityCases.category })
    .from(activityCases)
    .innerJoin(activityCaseSubjects, eq(activityCaseSubjects.caseId, activityCases.id))
    .where(eq(activityCaseSubjects.candidateId, candidateId))
    .orderBy(desc(activityCases.openedAt));
  return { recs, cases };
}

export const _unused = { ne, or };
