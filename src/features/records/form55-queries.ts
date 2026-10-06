// Data form 参考様式第5-5号 per pekerja (T-009): wawancara berkala satu tahun fiskal + wawancara karena kejadian (② 議事録・面談記録). Semua lewat RLS TSK.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { readForm55 } from "@/db/form55";
import { allWorkers } from "@/db/records-queries";
import { activityRecordSubjects, activityRecords, periodicInterviews, users } from "@/db/schema";
import type { Form55PdfData } from "@/lib/pdf/form55";

export type YearInterview = {
  id: string;
  month: string;
  applicable: boolean;
  interviewDate: string | null;
  resultStatus: string | null;
  method: string | null;
  responderName: string | null;
  responderRole: string | null;
  responderTitle: string | null;
  form: ReturnType<typeof readForm55>;
};
export type EventMeeting = { id: string; recordDate: string; subject: string | null; authorName: string };

type Worker = Awaited<ReturnType<typeof allWorkers>>[number];

const fyRange = (fy: number) => ({ from: `${fy}-04-01`, to: `${fy + 1}-03-01` });

/** Wawancara berkala AKTIF satu pekerja di satu tahun fiskal, urut bulan. */
export async function yearInterviews(tx: Tx, candidateId: string, fy: number): Promise<YearInterview[]> {
  const { from, to } = fyRange(fy);
  const rows = await tx
    .select({ r: periodicInterviews, staffName: users.name })
    .from(periodicInterviews)
    .leftJoin(users, eq(users.id, periodicInterviews.staffId))
    .where(and(eq(periodicInterviews.candidateId, candidateId), eq(periodicInterviews.status, "active"), sql`${periodicInterviews.periodMonth} >= ${from}::date and ${periodicInterviews.periodMonth} <= ${to}::date`))
    .orderBy(asc(periodicInterviews.periodMonth));
  return rows.map(({ r, staffName }) => ({
    id: r.id, month: r.periodMonth, applicable: r.applicable, interviewDate: r.interviewDate, resultStatus: r.resultStatus, method: r.method,
    responderName: staffName, responderRole: r.responderRole, responderTitle: r.responderTitle, form: readForm55(r.form55),
  }));
}

/** 面談 karena kejadian: catatan ② (議事録・面談記録) AKTIF yang menyebut pekerja ini dalam tahun fiskal. Terpisah dari 定期面談; tidak memakai form 5-5. */
export async function eventMeetings(tx: Tx, candidateId: string, fy: number): Promise<EventMeeting[]> {
  const { from } = fyRange(fy);
  const end = `${fy + 1}-03-31`;
  const rows = await tx
    .select({ id: activityRecords.id, recordDate: activityRecords.recordDate, subject: activityRecords.subject, authorName: users.name })
    .from(activityRecords)
    .innerJoin(activityRecordSubjects, eq(activityRecordSubjects.recordId, activityRecords.id))
    .innerJoin(users, eq(users.id, activityRecords.authorId))
    .where(and(eq(activityRecordSubjects.candidateId, candidateId), eq(activityRecords.kind, "meeting"), eq(activityRecords.status, "active"), sql`${activityRecords.recordDate} >= ${from}::date and ${activityRecords.recordDate} <= ${end}::date`))
    .orderBy(asc(activityRecords.recordDate), asc(activityRecords.createdAt));
  return rows;
}

/** Susun data PDF satu wawancara: pekerja + perusahaan penerima dari `allWorkers`, 対応者 dari staf yang tersimpan. */
export function toForm55Pdf(w: Worker, r: YearInterview): Form55PdfData {
  return { workerName: w.fullName, orgName: w.companyName, interviewDate: r.interviewDate, method: r.method, responderName: r.responderName, responderRole: r.responderRole, responderTitle: r.responderTitle, form: r.form };
}

/** Yang ikut PDF gabungan: wawancara berlaku dan benar-benar dilaksanakan (bukan "Belum dilaksanakan"). */
export const isConducted = (r: YearInterview) => r.applicable && r.resultStatus !== null && r.resultStatus !== "not_done";
