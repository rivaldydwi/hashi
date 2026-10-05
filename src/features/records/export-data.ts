// Pengumpul data untuk ekspor PDF (server). Semua lewat transaksi tenant (RLS). Foto dibaca dari penyimpanan privat dan diubah ke JPEG/PNG untuk PDF.
import { readFile } from "node:fs/promises";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import sharp from "sharp";
import type { Tx } from "@/db";
import { activityAttachments, activityCaseSubjects, activityCases, activityRecordHandlers, activityRecordRecipients, activityRecordSubjects, activityRecords, candidates, caseTimelineEvents, clientCompanies, clientSites, placements, users } from "@/db/schema";
import { cleanSections } from "@/db/records-core";
import type { CaseData, CaseEventData, DailyData, MeetingData, Photo } from "@/lib/pdf/exports";
import { attachmentPath } from "./images";

const ext = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");

/** Foto lampiran yang ditandai "sertakan di PDF" (maks 6). WebP diubah ke JPEG karena pdfkit hanya mendukung JPEG/PNG. */
export async function photosFor(tx: Tx, orgId: string, recordId: string): Promise<Photo[]> {
  const atts = await tx.select().from(activityAttachments).where(and(eq(activityAttachments.recordId, recordId), eq(activityAttachments.includeInPdf, true), isNull(activityAttachments.removedAt))).orderBy(asc(activityAttachments.createdAt)).limit(6);
  const out: Photo[] = [];
  for (const a of atts) {
    try {
      let data = await readFile(attachmentPath(orgId, a.id, ext(a.mime)));
      if (a.mime === "image/webp") data = await sharp(data).jpeg({ quality: 88 }).toBuffer();
      out.push({ data, caption: a.caption });
    } catch {
      /* berkas hilang di disk: lewati foto itu, jangan menggagalkan ekspor */
    }
  }
  return out;
}

async function recordHeader(tx: Tx, ids: string[]) {
  const [subs, handlers, recipients] = await Promise.all([
    tx.select({ recordId: activityRecordSubjects.recordId, name: candidates.fullName }).from(activityRecordSubjects).innerJoin(candidates, eq(candidates.id, activityRecordSubjects.candidateId)).where(inArray(activityRecordSubjects.recordId, ids)).orderBy(asc(candidates.fullName)),
    tx.select({ recordId: activityRecordHandlers.recordId, name: users.name }).from(activityRecordHandlers).innerJoin(users, eq(users.id, activityRecordHandlers.userId)).where(inArray(activityRecordHandlers.recordId, ids)).orderBy(asc(users.name)),
    tx.select({ recordId: activityRecordRecipients.recordId, name: users.name }).from(activityRecordRecipients).innerJoin(users, eq(users.id, activityRecordRecipients.userId)).where(inArray(activityRecordRecipients.recordId, ids)).orderBy(asc(users.name)),
  ]);
  return { subs, handlers, recipients };
}

export async function loadRecordForPdf(tx: Tx, orgId: string, id: string): Promise<{ kind: "daily_work"; data: DailyData } | { kind: "meeting"; data: MeetingData } | null> {
  const [row] = await tx
    .select({ r: activityRecords, authorName: users.name, siteName: clientSites.name, companyName: clientCompanies.name })
    .from(activityRecords)
    .innerJoin(users, eq(users.id, activityRecords.authorId))
    .leftJoin(clientSites, eq(clientSites.id, activityRecords.clientSiteId))
    .leftJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .where(eq(activityRecords.id, id))
    .limit(1);
  if (!row) return null;
  const { subs, handlers, recipients } = await recordHeader(tx, [id]);
  const photos = await photosFor(tx, orgId, id);
  const r = row.r;
  if (r.kind === "meeting") {
    return {
      kind: "meeting",
      data: { subject: r.subject ?? "", startedAt: r.startedAt!, endedAt: r.endedAt, subjects: subs.map((s) => s.name), handlers: handlers.map((h) => h.name), method: r.method, sections: cleanSections(r.sections), status: r.status, voidReason: r.voidReason, photos },
    };
  }
  return { kind: "daily_work", data: toDaily(r, row.authorName, subs.map((s) => s.name), row.companyName ? `${row.companyName} / ${row.siteName}` : null, recipients.map((x) => x.name), photos) };
}

function toDaily(r: typeof activityRecords.$inferSelect, authorName: string, subjects: string[], site: string | null, appRecipients: string[], photos: Photo[]): DailyData {
  return {
    date: r.recordDate, authorName, subjects, site, workType: r.workType, workTypeOther: r.workTypeOther, actionTaken: r.actionTaken, result: r.result, pending: r.pending, nextAction: r.nextAction,
    reportTo: [r.reportToText, appRecipients.length ? appRecipients.join("、") : null].filter(Boolean).join(" / "), note: r.note, status: r.status, voidReason: r.voidReason, photos,
  };
}

/** Laporan harian: semua ① (aktif DAN batal) pada tanggal itu, berurutan menurut waktu dibuat; opsional satu staf. */
export async function loadDailyForPdf(tx: Tx, orgId: string, date: string, staffId: string | null) {
  const rows = await tx
    .select({ r: activityRecords, authorName: users.name, siteName: clientSites.name, companyName: clientCompanies.name })
    .from(activityRecords)
    .innerJoin(users, eq(users.id, activityRecords.authorId))
    .leftJoin(clientSites, eq(clientSites.id, activityRecords.clientSiteId))
    .leftJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId))
    .where(and(eq(activityRecords.kind, "daily_work"), eq(activityRecords.recordDate, date), staffId ? eq(activityRecords.authorId, staffId) : undefined))
    .orderBy(asc(users.name), asc(activityRecords.createdAt));
  if (rows.length === 0) return { staffName: null as string | null, records: [] as DailyData[] };
  const ids = rows.map((x) => x.r.id);
  const { subs, recipients } = await recordHeader(tx, ids);
  const records: DailyData[] = [];
  for (const x of rows) {
    records.push(toDaily(x.r, x.authorName, subs.filter((s) => s.recordId === x.r.id).map((s) => s.name), x.companyName ? `${x.companyName} / ${x.siteName}` : null, recipients.filter((s) => s.recordId === x.r.id).map((s) => s.name), await photosFor(tx, orgId, x.r.id)));
  }
  return { staffName: staffId ? rows[0].authorName : null, records };
}

export async function loadCaseForPdf(tx: Tx, id: string): Promise<{ kase: CaseData; events: Array<CaseEventData & { includeInClientExport: boolean }> } | null> {
  const [c] = await tx.select().from(activityCases).where(eq(activityCases.id, id)).limit(1);
  if (!c) return null;
  const subs = await tx.select({ id: candidates.id, name: candidates.fullName }).from(activityCaseSubjects).innerJoin(candidates, eq(candidates.id, activityCaseSubjects.candidateId)).where(eq(activityCaseSubjects.caseId, id)).orderBy(asc(candidates.fullName));
  let site: string | null = null;
  if (subs.length) {
    const sites = await tx.select({ company: clientCompanies.name, site: clientSites.name }).from(placements).innerJoin(clientSites, eq(clientSites.id, placements.siteId)).innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId)).where(and(eq(placements.status, "ACTIVE"), inArray(placements.candidateId, subs.map((s) => s.id))));
    site = [...new Set(sites.map((s) => `${s.company} / ${s.site}`))].join("、") || null;
  }
  const events = await tx
    .select({ e: caseTimelineEvents, creatorName: users.name })
    .from(caseTimelineEvents)
    .innerJoin(users, eq(users.id, caseTimelineEvents.createdBy))
    .where(eq(caseTimelineEvents.caseId, id))
    .orderBy(asc(caseTimelineEvents.occurredAt), asc(caseTimelineEvents.createdAt));
  return {
    kase: { code: c.code, title: c.title, category: c.category, status: c.status, openedAt: c.openedAt, subjects: subs.map((s) => s.name), site },
    events: events.map(({ e, creatorName }) => ({ occurredAt: e.occurredAt, timeKnown: e.timeKnown, event: e.event, subjectStatement: e.subjectStatement, companyResponse: e.companyResponse, note: e.note, status: e.status, voidReason: e.voidReason, creatorName, includeInClientExport: e.includeInClientExport })),
  };
}
