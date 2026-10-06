"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  activityAttachments, activityCaseSubjects, activityCases, activityDailyReportRecipients, activityDailyReports, activityFollowups, activityRecordHandlers,
  activityRecordReads, activityRecordRecipients, activityRecordSubjects, activityRecords, candidates, caseTimelineEvents, clientCompanies, periodicInterviewQuarterNotes,
  periodicInterviews, placements, clientSites, users,
} from "@/db/schema";
import {
  CASE_CATEGORIES, COUNTERPARTIES, INTERVIEW_REASONS, INTERVIEW_RESULTS, MAX_ATTACHMENTS_PER_RECORD, MEETING_METHODS, WORK_TYPES, cleanSections,
} from "@/db/records-core";
import { activeWorkers } from "@/db/records-queries";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery, type CurrentUser } from "@/lib/session";
import { requireStaffAction } from "./access";
import { all, bool, dtLocal, hm, str, strOrNull, uuid, uuids, ymd } from "./form";
import { attachmentPath, checkImage, removeAttachmentFile, sanitizeImage, writeAttachment } from "./images";

// ---------------------------------------------------------------------------------------------------- umum
const ok = (id?: string, key = "records.saved"): FormState => ({ status: "success", key, ...(id ? { id } : {}) });
const tzOf = (me: CurrentUser) => safeTimezone(me.organizationTimezone, me.organizationType);
const todayOf = (me: CurrentUser) => ymdIn(new Date(), tzOf(me));
const at = (v: string, tz: string) => sql`(${v}::timestamp at time zone ${tz})`;

async function run(fn: (me: CurrentUser) => Promise<FormState>): Promise<FormState> {
  const me = await requireStaffAction();
  try {
    return await fn(me);
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    const code = pgErrorCode(err);
    if (code === "23514") return { status: "error", key: "records.errors.invalid" }; // CHECK / trigger penjaga
    if (code === "42501") return { status: "error", key: "records.errors.notAllowed" }; // RLS
    if (code === "23505") return { status: "error", key: "records.errors.duplicate" };
    throw err;
  }
}

/** Catat audit di log organisasi TSK saja (LPK tidak pernah membacanya). Hanya jenis/status/kategori; tidak pernah isi, nama pekerja, atau nama berkas. */
function log(tx: Tx, me: CurrentUser, action: string, entity: string, entityId: string, after?: Record<string, unknown>) {
  return audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action, entity, entityId, after });
}

const changedNames = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).sort();

async function assertWorkers(tx: Tx, ids: string[], keep: string[] = []) {
  if (ids.length === 0) return;
  const allowed = new Set([...(await activeWorkers(tx)).map((w) => w.id), ...keep]);
  if (ids.some((id) => !allowed.has(id))) throw new ActionError("records.errors.workerInvalid");
}

async function staffIds(tx: Tx): Promise<Set<string>> {
  return new Set((await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, ["TSK_ADMIN", "TSK_STAFF"]), eq(users.active, true)))).map((r) => r.id));
}

/** Ganti himpunan terkait (pekerja/hadirin/penerima): hapus yang tidak ada lagi, tambah yang baru. Dipanggil SETELAH baris induk diubah (supaya riwayat memuat himpunan lama). */
async function syncSet(tx: Tx, table: "subjects" | "handlers" | "recipients", recordId: string, orgId: string, wanted: string[]) {
  const cfg = {
    subjects: { t: activityRecordSubjects, col: activityRecordSubjects.candidateId, rec: activityRecordSubjects.recordId },
    handlers: { t: activityRecordHandlers, col: activityRecordHandlers.userId, rec: activityRecordHandlers.recordId },
    recipients: { t: activityRecordRecipients, col: activityRecordRecipients.userId, rec: activityRecordRecipients.recordId },
  }[table];
  const current = (await tx.select({ v: cfg.col }).from(cfg.t).where(eq(cfg.rec, recordId))).map((r) => r.v as string);
  const drop = current.filter((x) => !wanted.includes(x));
  const add = wanted.filter((x) => !current.includes(x));
  if (drop.length) await tx.delete(cfg.t).where(and(eq(cfg.rec, recordId), inArray(cfg.col, drop)));
  if (add.length) {
    if (table === "subjects") await tx.insert(activityRecordSubjects).values(add.map((candidateId) => ({ recordId, candidateId, organizationId: orgId })));
    if (table === "handlers") await tx.insert(activityRecordHandlers).values(add.map((userId) => ({ recordId, userId, organizationId: orgId })));
    if (table === "recipients") await tx.insert(activityRecordRecipients).values(add.map((userId) => ({ recordId, userId, organizationId: orgId })));
  }
  return drop.length + add.length > 0;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// ---------------------------------------------------------------------------------------------------- catatan ① dan ②
export async function saveRecord(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    const editing = id !== "";
    if (editing && !uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    const kindRaw = str(fd, "kind");
    const tz = tzOf(me);
    const today = todayOf(me);

    const recordDate = ymd.safeParse(str(fd, "recordDate"));
    if (!recordDate.success || recordDate.data > today) throw new ActionError("records.errors.dateInvalid");
    const subjectIds = [...new Set(all(fd, "subjects"))];
    const recipientIds = [...new Set(all(fd, "recipients"))];
    const handlerIds = [...new Set(all(fd, "handlers"))];
    if (!uuids([...subjectIds, ...recipientIds, ...handlerIds])) throw new ActionError("records.errors.invalid");
    const siteRaw = str(fd, "clientSiteId");
    const caseRaw = str(fd, "caseId");
    if ((siteRaw && !uuid.safeParse(siteRaw).success) || (caseRaw && !uuid.safeParse(caseRaw).success)) throw new ActionError("records.errors.invalid");
    const authorRaw = str(fd, "authorId");
    if (authorRaw && !uuid.safeParse(authorRaw).success) throw new ActionError("records.errors.invalid");
    // "Lanjutkan catatan" (T-007): hanya saat membuat; terkunci setelahnya (trigger database)
    const continuesRaw = editing ? "" : str(fd, "continuesRecordId");
    if (continuesRaw && !uuid.safeParse(continuesRaw).success) throw new ActionError("records.errors.invalid");

    let values: Record<string, unknown>;
    let kind: "daily_work" | "meeting";
    if (kindRaw === "daily_work") {
      kind = "daily_work";
      const workType = str(fd, "workType");
      if (!(WORK_TYPES as readonly string[]).includes(workType)) throw new ActionError("records.errors.workTypeRequired");
      const workTypeOther = strOrNull(fd, "workTypeOther", 200);
      if (workType === "other" && !workTypeOther) throw new ActionError("records.errors.workTypeOtherRequired");
      const actionTaken = strOrNull(fd, "actionTaken");
      const result = strOrNull(fd, "result");
      if (!actionTaken && !result) throw new ActionError("records.errors.contentRequired");
      values = {
        workType, workTypeOther: workType === "other" ? workTypeOther : null, actionTaken, result, pending: strOrNull(fd, "pending"), nextAction: strOrNull(fd, "nextAction"),
        reportToText: strOrNull(fd, "reportToText", 500), note: strOrNull(fd, "note"),
      };
    } else if (kindRaw === "meeting") {
      kind = "meeting";
      const subject = strOrNull(fd, "meetingSubject", 300);
      const started = dtLocal.safeParse(str(fd, "startedAt"));
      const ended = str(fd, "endedAt");
      if (!subject) throw new ActionError("records.errors.subjectRequired");
      if (!started.success) throw new ActionError("records.errors.startRequired");
      if (ended && (!dtLocal.safeParse(ended).success || ended < started.data)) throw new ActionError("records.errors.endBeforeStart");
      const method = str(fd, "method");
      const counterparty = str(fd, "counterparty") || "client";
      if ((method && !(MEETING_METHODS as readonly string[]).includes(method)) || !(COUNTERPARTIES as readonly string[]).includes(counterparty)) throw new ActionError("records.errors.invalid");
      const companyRaw = str(fd, "clientCompanyId");
      if (companyRaw && !uuid.safeParse(companyRaw).success) throw new ActionError("records.errors.invalid");
      let sections: unknown = {};
      try {
        sections = JSON.parse(str(fd, "sections") || "{}");
      } catch {
        throw new ActionError("records.errors.invalid");
      }
      values = { subject, startedAt: at(started.data, tz), endedAt: ended ? at(ended, tz) : null, method: method || null, counterparty, clientCompanyId: companyRaw || null, sections: cleanSections(sections) };
    } else throw new ActionError("records.errors.invalid");

    let timelineRows: Array<Record<string, string>> = [];
    try {
      const raw = JSON.parse(str(fd, "timeline") || "[]");
      if (Array.isArray(raw)) timelineRows = raw.filter((r) => r && typeof r === "object").slice(0, 30);
    } catch {
      throw new ActionError("records.errors.invalid");
    }

    let resultId = id;
    await tenantQuery(async (tx) => {
      let keep: string[] = [];
      if (editing) keep = (await tx.select({ c: activityRecordSubjects.candidateId }).from(activityRecordSubjects).where(eq(activityRecordSubjects.recordId, id))).map((r) => r.c);
      await assertWorkers(tx, subjectIds, keep);
      const staff = await staffIds(tx);
      if ([...recipientIds, ...handlerIds, ...(authorRaw ? [authorRaw] : [])].some((u) => !staff.has(u))) throw new ActionError("records.errors.staffInvalid");

      // 所属先: dari kolom, atau dari penempatan aktif pekerja pertama
      let siteId: string | null = siteRaw || null;
      if (!siteId && subjectIds[0]) {
        const [p] = await tx.select({ s: placements.siteId }).from(placements).where(and(eq(placements.candidateId, subjectIds[0]), eq(placements.status, "ACTIVE"))).limit(1);
        siteId = p?.s ?? null;
      }
      if (siteId && !(await tx.select({ id: clientSites.id }).from(clientSites).where(eq(clientSites.id, siteId)).limit(1)).length) throw new ActionError("records.errors.invalid");
      if (kind === "meeting" && values.clientCompanyId) {
        if (!(await tx.select({ id: clientCompanies.id }).from(clientCompanies).where(eq(clientCompanies.id, values.clientCompanyId as string)).limit(1)).length) throw new ActionError("records.errors.invalid");
      }
      const base = { recordDate: recordDate.data, caseId: caseRaw || null, clientSiteId: siteId };
      if (continuesRaw) {
        // catatan asal: terlihat (RLS = organisasi sama), aktif, dan menyebut setidaknya satu pekerja yang sama (database memeriksa lagi saat commit)
        const [parent] = await tx.select({ status: activityRecords.status }).from(activityRecords).where(eq(activityRecords.id, continuesRaw)).limit(1);
        if (!parent || parent.status !== "active") throw new ActionError("records.errors.continueInvalid");
        const parentSubjects = (await tx.select({ c: activityRecordSubjects.candidateId }).from(activityRecordSubjects).where(eq(activityRecordSubjects.recordId, continuesRaw))).map((r) => r.c);
        if (!subjectIds.some((s) => parentSubjects.includes(s))) throw new ActionError("records.errors.continueSubjects");
      }

      if (!editing) {
        const [row] = await tx
          .insert(activityRecords)
          .values({ organizationId: me.organizationId, createdBy: me.id, authorId: me.role === "TSK_ADMIN" && authorRaw ? authorRaw : me.id, kind, ...base, ...values, continuesRecordId: continuesRaw || null } as typeof activityRecords.$inferInsert)
          .returning({ id: activityRecords.id });
        resultId = row.id;
        await syncSet(tx, "subjects", row.id, me.organizationId, subjectIds);
        if (kind === "meeting") await syncSet(tx, "handlers", row.id, me.organizationId, handlerIds.length ? handlerIds : [me.id]);
        if (recipientIds.length) await syncSet(tx, "recipients", row.id, me.organizationId, recipientIds);
        await log(tx, me, "activity_record.create", "activity_record", row.id, { kind, ...(kind === "daily_work" ? { workType: values.workType } : {}), ...(continuesRaw ? { continued: true } : {}) });
      } else {
        const [before] = await tx.select().from(activityRecords).where(eq(activityRecords.id, id)).limit(1);
        if (!before || before.status !== "active") throw new ActionError("records.errors.notAllowed");
        if (before.kind !== kind) throw new ActionError("records.errors.invalid");
        const curSubjects = keep;
        const curHandlers = (await tx.select({ u: activityRecordHandlers.userId }).from(activityRecordHandlers).where(eq(activityRecordHandlers.recordId, id))).map((r) => r.u);
        const curRecipients = (await tx.select({ u: activityRecordRecipients.userId }).from(activityRecordRecipients).where(eq(activityRecordRecipients.recordId, id))).map((r) => r.u);
        const nextHandlers = kind === "meeting" ? (handlerIds.length ? handlerIds : [me.id]) : curHandlers;
        // kolom yang berubah (perbandingan nilai teks; waktu dibandingkan sebagai teks yang sama dari form)
        const cmp: Record<string, unknown> = { ...base, ...values };
        delete cmp.startedAt; delete cmp.endedAt;
        const beforeCmp: Record<string, unknown> = { ...before };
        const fields = changedNames(beforeCmp, cmp);
        const startedChanged = kind === "meeting" && str(fd, "startedAt") !== fmtLocal(before.startedAt, tz);
        const endedChanged = kind === "meeting" && str(fd, "endedAt") !== fmtLocal(before.endedAt, tz);
        if (startedChanged) fields.push("startedAt");
        if (endedChanged) fields.push("endedAt");
        const authorChange = me.role === "TSK_ADMIN" && authorRaw && authorRaw !== before.authorId;
        if (authorChange) fields.push("authorId");
        if (!sameSet(curSubjects, subjectIds)) fields.push("subjects");
        if (!sameSet(curHandlers, nextHandlers)) fields.push("handlers");
        if (!sameSet(curRecipients, recipientIds)) fields.push("recipients");
        if (fields.length === 0) return;
        // Baris induk diubah LEBIH DULU (trigger menyimpan himpunan lama ke riwayat), baru himpunan terkait
        const upd = await tx.update(activityRecords).set({ ...base, ...values, ...(authorChange ? { authorId: authorRaw } : {}) } as Partial<typeof activityRecords.$inferInsert>).where(eq(activityRecords.id, id)).returning({ id: activityRecords.id });
        if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
        await syncSet(tx, "subjects", id, me.organizationId, subjectIds);
        if (kind === "meeting") await syncSet(tx, "handlers", id, me.organizationId, nextHandlers);
        await syncSet(tx, "recipients", id, me.organizationId, recipientIds);
        await log(tx, me, "activity_record.update", "activity_record", id, { kind, fields });
      }

      // ② terkait kasus: baris kronologi dari form
      if (kind === "meeting" && caseRaw && timelineRows.length) {
        for (const r of timelineRows) {
          const d = ymd.safeParse(String(r.date ?? ""));
          const t = r.time ? hm.safeParse(String(r.time)) : null;
          const event = String(r.event ?? "").trim();
          if (!d.success || (t && !t.success) || !event) continue;
          const [ev] = await tx.insert(caseTimelineEvents).values({
            organizationId: me.organizationId, createdBy: me.id, caseId: caseRaw, occurredAt: at(`${d.data}T${t?.data ?? "00:00"}`, tz) as never, timeKnown: Boolean(t?.success),
            event: event.slice(0, 4000), subjectStatement: String(r.subjectStatement ?? "").trim().slice(0, 4000) || null, companyResponse: String(r.companyResponse ?? "").trim().slice(0, 4000) || null,
            note: String(r.note ?? "").trim().slice(0, 4000) || null, sourceRecordId: resultId,
          }).returning({ id: caseTimelineEvents.id });
          await log(tx, me, "case_timeline_event.create", "case_timeline_event", ev.id);
        }
      }
    });
    revalidatePath("/records", "layout");
    return ok(resultId);
  });
}

/** Waktu (timestamptz) -> "YYYY-MM-DDTHH:mm" di zona organisasi, untuk membandingkan dengan isian form. */
function fmtLocal(d: Date | null, tz: string): string {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return p.replace(" ", "T");
}

export async function voidRecord(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    const reason = str(fd, "reason");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    if (!reason) throw new ActionError("records.errors.reasonRequired");
    await tenantQuery(async (tx) => {
      const [before] = await tx.select({ kind: activityRecords.kind }).from(activityRecords).where(eq(activityRecords.id, id)).limit(1);
      const done = await tx.update(activityRecords).set({ status: "void", voidReason: reason.slice(0, 1000) }).where(and(eq(activityRecords.id, id), eq(activityRecords.status, "active"))).returning({ id: activityRecords.id });
      if (done.length !== 1 || !before) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, "activity_record.void", "activity_record", id, { kind: before.kind, status: "void" });
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.voided");
  });
}

/** Tanda "sudah dibaca" (data fitur; sengaja tidak diaudit). Hanya atas nama sendiri (RLS). */
export async function markRecordRead(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    await tenantQuery(async (tx) => {
      const [r] = await tx.select({ v: activityRecords.versionNo }).from(activityRecords).where(eq(activityRecords.id, id)).limit(1);
      if (!r) throw new ActionError("records.errors.notAllowed");
      await tx
        .insert(activityRecordReads)
        .values({ recordId: id, userId: me.id, organizationId: me.organizationId, versionNoRead: r.v })
        .onConflictDoUpdate({ target: [activityRecordReads.recordId, activityRecordReads.userId], set: { readAt: new Date(), versionNoRead: r.v } });
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.readMarked");
  });
}

// ---------------------------------------------------------------------------------------------------- laporan harian
export async function shareDailyReport(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const date = ymd.safeParse(str(fd, "date"));
    if (!date.success || date.data > todayOf(me)) throw new ActionError("records.errors.dateInvalid");
    const extra = [...new Set(all(fd, "recipients"))];
    if (!uuids(extra)) throw new ActionError("records.errors.invalid");
    await tenantQuery(async (tx) => {
      const staff = await staffIds(tx);
      if (extra.some((u) => !staff.has(u))) throw new ActionError("records.errors.staffInvalid");
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(activityRecords).where(and(eq(activityRecords.kind, "daily_work"), eq(activityRecords.authorId, me.id), eq(activityRecords.recordDate, date.data), eq(activityRecords.status, "active")));
      if (!count.n) throw new ActionError("records.errors.noRecordsToShare");
      let [report] = await tx.select({ id: activityDailyReports.id }).from(activityDailyReports).where(and(eq(activityDailyReports.authorId, me.id), eq(activityDailyReports.reportDate, date.data))).limit(1);
      if (!report) {
        [report] = await tx.insert(activityDailyReports).values({ organizationId: me.organizationId, createdBy: me.id, authorId: me.id, reportDate: date.data }).returning({ id: activityDailyReports.id });
      }
      const admins = (await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "TSK_ADMIN"), eq(users.active, true)))).map((u) => u.id);
      const recipients = [...new Set([...admins, ...extra])].filter((u) => u !== me.id);
      if (recipients.length === 0) throw new ActionError("records.errors.noRecipients");
      await tx.update(activityDailyReports).set({ sharedAt: new Date() }).where(eq(activityDailyReports.id, report.id));
      await tx.insert(activityDailyReportRecipients).values(recipients.map((userId) => ({ reportId: report.id, userId, organizationId: me.organizationId }))).onConflictDoNothing();
      await log(tx, me, "activity_daily_report.share", "activity_daily_report", report.id);
    });
    revalidatePath("/records", "layout");
    return ok(undefined, "records.reportShared");
  });
}

export async function markReportRead(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    await tenantQuery(async (tx) => {
      const [rep] = await tx.select({ sharedAt: activityDailyReports.sharedAt }).from(activityDailyReports).where(eq(activityDailyReports.id, id)).limit(1);
      if (!rep?.sharedAt) throw new ActionError("records.errors.notAllowed");
      const done = await tx.update(activityDailyReportRecipients).set({ readAt: new Date(), readSharedAt: rep.sharedAt }).where(and(eq(activityDailyReportRecipients.reportId, id), eq(activityDailyReportRecipients.userId, me.id))).returning({ r: activityDailyReportRecipients.reportId });
      if (done.length !== 1) throw new ActionError("records.errors.notAllowed");
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.readMarked");
  });
}

// ---------------------------------------------------------------------------------------------------- kasus dan kronologi
const caseSchemaFields = (fd: FormData) => {
  const title = strOrNull(fd, "title", 300);
  const category = str(fd, "category");
  if (!title) throw new ActionError("records.errors.titleRequired");
  if (!(CASE_CATEGORIES as readonly string[]).includes(category)) throw new ActionError("records.errors.invalid");
  return { title, category };
};

export async function saveCase(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    const { title, category } = caseSchemaFields(fd);
    const subjectIds = [...new Set(all(fd, "subjects"))];
    if (!uuids(subjectIds) || (id && !uuid.safeParse(id).success)) throw new ActionError("records.errors.invalid");
    let resultId = id;
    await tenantQuery(async (tx) => {
      let keep: string[] = [];
      if (id) keep = (await tx.select({ c: activityCaseSubjects.candidateId }).from(activityCaseSubjects).where(eq(activityCaseSubjects.caseId, id))).map((r) => r.c);
      await assertWorkers(tx, subjectIds, keep);
      if (!id) {
        const [row] = await tx.insert(activityCases).values({ organizationId: me.organizationId, createdBy: me.id, title, category, code: "" }).returning({ id: activityCases.id });
        resultId = row.id;
        if (subjectIds.length) await tx.insert(activityCaseSubjects).values(subjectIds.map((candidateId) => ({ caseId: row.id, candidateId, organizationId: me.organizationId })));
        await log(tx, me, "activity_case.create", "activity_case", row.id, { category, status: "open" });
      } else {
        const [before] = await tx.select().from(activityCases).where(eq(activityCases.id, id)).limit(1);
        if (!before) throw new ActionError("records.errors.notAllowed");
        const fields = changedNames(before as never, { title, category });
        if (!sameSet(keep, subjectIds)) fields.push("subjects");
        if (!fields.length) return;
        const upd = await tx.update(activityCases).set({ title, category }).where(eq(activityCases.id, id)).returning({ id: activityCases.id });
        if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
        const drop = keep.filter((x) => !subjectIds.includes(x));
        const add = subjectIds.filter((x) => !keep.includes(x));
        if (drop.length) await tx.delete(activityCaseSubjects).where(and(eq(activityCaseSubjects.caseId, id), inArray(activityCaseSubjects.candidateId, drop)));
        if (add.length) await tx.insert(activityCaseSubjects).values(add.map((candidateId) => ({ caseId: id, candidateId, organizationId: me.organizationId })));
        await log(tx, me, "activity_case.update", "activity_case", id, { category, fields });
      }
    });
    revalidatePath("/records", "layout");
    return ok(resultId);
  });
}

export async function setCaseStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    const to = str(fd, "to");
    if (!uuid.safeParse(id).success || !["open", "closed"].includes(to)) throw new ActionError("records.errors.invalid");
    await tenantQuery(async (tx) => {
      const done = await tx.update(activityCases).set({ status: to }).where(and(eq(activityCases.id, id), eq(activityCases.status, to === "closed" ? "open" : "closed"))).returning({ c: activityCases.category });
      if (done.length !== 1) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, to === "closed" ? "activity_case.close" : "activity_case.reopen", "activity_case", id, { category: done[0].c, status: to });
    });
    revalidatePath("/records", "layout");
    return ok(id, to === "closed" ? "records.caseClosed" : "records.caseReopened");
  });
}

function eventValues(fd: FormData, tz: string) {
  const d = ymd.safeParse(str(fd, "date"));
  const timeRaw = str(fd, "time");
  const t = timeRaw ? hm.safeParse(timeRaw) : null;
  const event = strOrNull(fd, "event");
  if (!d.success || (t && !t.success)) throw new ActionError("records.errors.dateInvalid");
  if (!event) throw new ActionError("records.errors.eventRequired");
  return {
    occurredAt: at(`${d.data}T${t?.data ?? "00:00"}`, tz) as never,
    timeKnown: Boolean(t?.success),
    event,
    subjectStatement: strOrNull(fd, "subjectStatement"),
    companyResponse: strOrNull(fd, "companyResponse"),
    note: strOrNull(fd, "note"),
    includeInClientExport: fd.has("includeSet") ? bool(fd, "includeInClientExport") : true, // kotak tak dicentang tidak terkirim: penanda includeSet membedakannya
  };
}

export async function addTimelineEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const caseId = str(fd, "caseId");
    if (!uuid.safeParse(caseId).success) throw new ActionError("records.errors.invalid");
    const v = eventValues(fd, tzOf(me));
    await tenantQuery(async (tx) => {
      const [c] = await tx.select({ s: activityCases.status }).from(activityCases).where(eq(activityCases.id, caseId)).limit(1);
      if (!c) throw new ActionError("records.errors.notAllowed");
      const [row] = await tx.insert(caseTimelineEvents).values({ organizationId: me.organizationId, createdBy: me.id, caseId, ...v }).returning({ id: caseTimelineEvents.id });
      await log(tx, me, "case_timeline_event.create", "case_timeline_event", row.id);
    });
    revalidatePath("/records", "layout");
    return ok(caseId, "records.eventAdded");
  });
}

export async function updateTimelineEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    const v = eventValues(fd, tzOf(me));
    await tenantQuery(async (tx) => {
      const [before] = await tx.select().from(caseTimelineEvents).where(eq(caseTimelineEvents.id, id)).limit(1);
      if (!before) throw new ActionError("records.errors.notAllowed");
      const upd = await tx.update(caseTimelineEvents).set(v).where(and(eq(caseTimelineEvents.id, id), eq(caseTimelineEvents.status, "active"))).returning({ id: caseTimelineEvents.id });
      if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, "case_timeline_event.update", "case_timeline_event", id);
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.saved");
  });
}

export async function voidTimelineEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    const reason = str(fd, "reason");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    if (!reason) throw new ActionError("records.errors.reasonRequired");
    await tenantQuery(async (tx) => {
      const upd = await tx.update(caseTimelineEvents).set({ status: "void", voidReason: reason.slice(0, 1000) }).where(and(eq(caseTimelineEvents.id, id), eq(caseTimelineEvents.status, "active"))).returning({ id: caseTimelineEvents.id });
      if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, "case_timeline_event.void", "case_timeline_event", id, { status: "void" });
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.voided");
  });
}

const firstLine = (s: string | null, n = 60) => (s ?? "").split("\n")[0].slice(0, n);

/** Buat kasus dari catatan (① atau ②): judul dari perihal/isi, pekerja disalin, catatan ditautkan. */
export async function createCaseFromRecord(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const recordId = str(fd, "recordId");
    const category = str(fd, "category") || "other";
    if (!uuid.safeParse(recordId).success || !(CASE_CATEGORIES as readonly string[]).includes(category)) throw new ActionError("records.errors.invalid");
    let caseId = "";
    await tenantQuery(async (tx) => {
      const [rec] = await tx.select().from(activityRecords).where(eq(activityRecords.id, recordId)).limit(1);
      if (!rec || rec.status !== "active" || rec.caseId) throw new ActionError("records.errors.notAllowed");
      const title = firstLine(rec.subject ?? rec.actionTaken ?? rec.result, 80) || rec.recordDate;
      const [c] = await tx.insert(activityCases).values({ organizationId: me.organizationId, createdBy: me.id, title, category, code: "" }).returning({ id: activityCases.id });
      caseId = c.id;
      const subs = (await tx.select({ c: activityRecordSubjects.candidateId }).from(activityRecordSubjects).where(eq(activityRecordSubjects.recordId, recordId))).map((r) => r.c);
      if (subs.length) await tx.insert(activityCaseSubjects).values(subs.map((candidateId) => ({ caseId, candidateId, organizationId: me.organizationId })));
      const upd = await tx.update(activityRecords).set({ caseId }).where(eq(activityRecords.id, recordId)).returning({ id: activityRecords.id });
      if (upd.length !== 1) throw new ActionError("records.errors.notAllowed"); // bukan penulis/admin: seluruh transaksi batal
      await log(tx, me, "activity_case.create", "activity_case", caseId, { category, status: "open" });
    });
    // tanpa revalidatePath: form pemanggil mengalihkan halaman (revalidasi akan melepas form sebelum pengalihan berjalan)
    return ok(caseId, "records.caseCreated");
  });
}

/** ① -> satu baris kronologi (isian awal: 結果・状況 ke kolom kejadian, 対応内容 ke tanggapan perusahaan). caseId boleh "new". */
export async function addRecordToTimeline(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const recordId = str(fd, "recordId");
    let caseId = str(fd, "caseId");
    if (!uuid.safeParse(recordId).success || (caseId !== "new" && !uuid.safeParse(caseId).success)) throw new ActionError("records.errors.invalid");
    const tz = tzOf(me);
    await tenantQuery(async (tx) => {
      const [rec] = await tx.select().from(activityRecords).where(eq(activityRecords.id, recordId)).limit(1);
      if (!rec || rec.status !== "active") throw new ActionError("records.errors.notAllowed");
      if (caseId === "new") {
        const [c] = await tx.insert(activityCases).values({ organizationId: me.organizationId, createdBy: me.id, title: firstLine(rec.actionTaken ?? rec.result, 80) || rec.recordDate, category: str(fd, "category") || "other", code: "" }).returning({ id: activityCases.id });
        caseId = c.id;
        const subs = (await tx.select({ c: activityRecordSubjects.candidateId }).from(activityRecordSubjects).where(eq(activityRecordSubjects.recordId, recordId))).map((r) => r.c);
        if (subs.length) await tx.insert(activityCaseSubjects).values(subs.map((candidateId) => ({ caseId, candidateId, organizationId: me.organizationId })));
        await log(tx, me, "activity_case.create", "activity_case", caseId, { category: str(fd, "category") || "other", status: "open" });
      }
      const [ev] = await tx.insert(caseTimelineEvents).values({
        organizationId: me.organizationId, createdBy: me.id, caseId, occurredAt: at(`${rec.recordDate}T00:00`, tz) as never, timeKnown: false,
        event: rec.result ?? rec.actionTaken ?? "-", companyResponse: rec.result ? rec.actionTaken : null, sourceRecordId: recordId,
      }).returning({ id: caseTimelineEvents.id });
      await log(tx, me, "case_timeline_event.create", "case_timeline_event", ev.id);
    });
    // tanpa revalidatePath: form pemanggil mengalihkan halaman (revalidasi akan melepas form sebelum pengalihan berjalan)
    return ok(caseId, "records.eventAdded");
  });
}

// ---------------------------------------------------------------------------------------------------- tugas tindak lanjut
export async function createFollowup(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const description = strOrNull(fd, "description", 1000);
    const assignee = str(fd, "assigneeId") || me.id;
    const due = str(fd, "dueDate");
    const parent = { recordId: str(fd, "recordId") || null, caseId: str(fd, "caseId") || null, interviewId: str(fd, "interviewId") || null };
    if (!description) throw new ActionError("records.errors.descriptionRequired");
    if (!uuid.safeParse(assignee).success || (due && !ymd.safeParse(due).success) || Object.values(parent).some((v) => v && !uuid.safeParse(v).success) || !Object.values(parent).some(Boolean)) throw new ActionError("records.errors.invalid");
    let id = "";
    await tenantQuery(async (tx) => {
      if (!(await staffIds(tx)).has(assignee)) throw new ActionError("records.errors.staffInvalid");
      const [row] = await tx.insert(activityFollowups).values({ organizationId: me.organizationId, createdBy: me.id, description, assigneeId: assignee, dueDate: due || null, ...parent }).returning({ id: activityFollowups.id });
      id = row.id;
      await log(tx, me, "activity_followup.create", "activity_followup", id, { status: "open" });
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.taskAdded");
  });
}

export async function setFollowupStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    const to = str(fd, "to");
    if (!uuid.safeParse(id).success || !["done", "cancelled"].includes(to)) throw new ActionError("records.errors.invalid");
    await tenantQuery(async (tx) => {
      const upd = await tx.update(activityFollowups).set({ status: to }).where(and(eq(activityFollowups.id, id), eq(activityFollowups.status, "open"))).returning({ id: activityFollowups.id });
      if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, "activity_followup.status_change", "activity_followup", id, { status: to });
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.taskUpdated");
  });
}

// ---------------------------------------------------------------------------------------------------- wawancara berkala
export async function savePeriodicInterview(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const candidateId = str(fd, "candidateId");
    const month = str(fd, "month");
    const tz = tzOf(me);
    const today = todayOf(me);
    if (!uuid.safeParse(candidateId).success || !ymd.safeParse(month).success || !month.endsWith("-01")) throw new ActionError("records.errors.invalid");
    if (month > `${today.slice(0, 7)}-01`) throw new ActionError("records.errors.monthFuture");
    const applicable = fd.get("applicable") !== "no";
    const note = strOrNull(fd, "note");
    let v: Record<string, unknown>;
    if (!applicable) {
      v = { applicable: false, interviewDate: null, resultStatus: null, reason: null, content: null, staffId: null, note };
    } else {
      const result = str(fd, "resultStatus");
      const reason = str(fd, "reason");
      const date = str(fd, "interviewDate");
      const staff = str(fd, "staffId") || me.id;
      if (!(INTERVIEW_RESULTS as readonly string[]).includes(result)) throw new ActionError("records.errors.resultRequired");
      if (reason && !(INTERVIEW_REASONS as readonly string[]).includes(reason)) throw new ActionError("records.errors.invalid");
      if (result !== "not_done") {
        if (!ymd.safeParse(date).success || date > today) throw new ActionError("records.errors.dateInvalid");
        if (!reason) throw new ActionError("records.errors.reasonSelectRequired");
      }
      if (!uuid.safeParse(staff).success) throw new ActionError("records.errors.invalid");
      v = { applicable: true, interviewDate: result !== "not_done" && date ? date : null, resultStatus: result, reason: reason || null, content: strOrNull(fd, "content", 8000), staffId: staff, note };
    }
    let id = "";
    await tenantQuery(async (tx) => {
      const [existing] = await tx.select().from(periodicInterviews).where(and(eq(periodicInterviews.candidateId, candidateId), eq(periodicInterviews.periodMonth, month), eq(periodicInterviews.status, "active"))).limit(1);
      await assertWorkers(tx, [candidateId], existing ? [candidateId] : []);
      if (v.staffId && !(await staffIds(tx)).has(v.staffId as string)) throw new ActionError("records.errors.staffInvalid");
      const period = month.slice(0, 7);
      if (!existing) {
        const [row] = await tx.insert(periodicInterviews).values({ organizationId: me.organizationId, createdBy: me.id, candidateId, periodMonth: month, ...v } as typeof periodicInterviews.$inferInsert).returning({ id: periodicInterviews.id });
        id = row.id;
        await log(tx, me, "periodic_interview.create", "periodic_interview", id, { resultStatus: v.resultStatus ?? undefined, reason: v.reason ?? undefined, period });
      } else {
        id = existing.id;
        const fields = changedNames(existing as never, v);
        if (!fields.length) return;
        await tx.update(periodicInterviews).set(v as never).where(eq(periodicInterviews.id, id));
        await log(tx, me, "periodic_interview.update", "periodic_interview", id, { resultStatus: v.resultStatus ?? undefined, reason: v.reason ?? undefined, period, fields });
      }
    });
    void tz;
    revalidatePath("/records", "layout");
    return ok(id);
  });
}

export async function voidPeriodicInterview(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    const reason = str(fd, "reason");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    if (!reason) throw new ActionError("records.errors.reasonRequired");
    await tenantQuery(async (tx) => {
      const upd = await tx.update(periodicInterviews).set({ status: "void", voidReason: reason.slice(0, 1000) }).where(and(eq(periodicInterviews.id, id), eq(periodicInterviews.status, "active"))).returning({ m: periodicInterviews.periodMonth });
      if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, "periodic_interview.void", "periodic_interview", id, { status: "void", period: upd[0].m.slice(0, 7) });
    });
    // tanpa revalidatePath: form pemanggil mengalihkan halaman (revalidasi akan melepas form sebelum pengalihan berjalan)
    return ok(id, "records.voided");
  });
}

export async function saveQuarterNote(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const candidateId = str(fd, "candidateId");
    const fy = Number.parseInt(str(fd, "fiscalYear"), 10);
    const quarter = Number.parseInt(str(fd, "quarter"), 10);
    if (!uuid.safeParse(candidateId).success || !Number.isInteger(fy) || fy < 2020 || fy > 2100 || ![1, 2, 3, 4].includes(quarter)) throw new ActionError("records.errors.invalid");
    const note = strOrNull(fd, "note", 4000);
    await tenantQuery(async (tx) => {
      await assertWorkers(tx, [candidateId], [candidateId]);
      await tx
        .insert(periodicInterviewQuarterNotes)
        .values({ organizationId: me.organizationId, createdBy: me.id, candidateId, fiscalYear: fy, quarter, note })
        .onConflictDoUpdate({ target: [periodicInterviewQuarterNotes.candidateId, periodicInterviewQuarterNotes.fiscalYear, periodicInterviewQuarterNotes.quarter], set: { note, updatedAt: new Date() } });
      // catatan kuartal dicatat sebagai perubahan wawancara berkala (hanya tahun fiskal dan kuartal; tanpa isi dan tanpa nama pekerja)
      await log(tx, me, "periodic_interview.update", "periodic_interview", candidateId, { period: `${fy}-Q${quarter}`, fields: ["quarterNote"] });
    });
    revalidatePath("/records", "layout");
    return ok(undefined, "records.saved");
  });
}

// ---------------------------------------------------------------------------------------------------- lampiran foto
export async function uploadAttachment(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const recordId = str(fd, "recordId") || null;
    const interviewId = str(fd, "interviewId") || null;
    if ((recordId ? 1 : 0) + (interviewId ? 1 : 0) !== 1 || (recordId && !uuid.safeParse(recordId).success) || (interviewId && !uuid.safeParse(interviewId).success)) throw new ActionError("records.errors.invalid");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("records.errors.noFile");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkImage(bytes);
    if ("error" in check) throw new ActionError(`records.errors.photo_${check.error}`);
    let clean: Buffer;
    try {
      clean = await sanitizeImage(bytes, check.kind);
    } catch {
      throw new ActionError("records.errors.photo_unreadable");
    }
    const id = randomUUID();
    let written: string | null = null;
    try {
      await tenantQuery(async (tx) => {
        if (recordId) {
          const [rec] = await tx.select({ s: activityRecords.status, a: activityRecords.authorId, c: activityRecords.createdBy }).from(activityRecords).where(eq(activityRecords.id, recordId)).limit(1);
          if (!rec || rec.s !== "active" || !(rec.a === me.id || rec.c === me.id || me.role === "TSK_ADMIN")) throw new ActionError("records.errors.notAllowed");
        }
        const cond = recordId ? eq(activityAttachments.recordId, recordId) : eq(activityAttachments.interviewId, interviewId!);
        const [cnt] = await tx.select({ n: sql<number>`count(*)::int` }).from(activityAttachments).where(and(cond, isNull(activityAttachments.removedAt)));
        if (cnt.n >= MAX_ATTACHMENTS_PER_RECORD) throw new ActionError("records.errors.photoLimit");
        await tx.insert(activityAttachments).values({
          id, organizationId: me.organizationId, createdBy: me.id, recordId, interviewId, mime: check.kind.mime, sizeBytes: clean.length,
          originalName: (file.name || "foto").replace(/[\\/\u0000-\u001f"]/g, "_").slice(0, 120), caption: strOrNull(fd, "caption", 300), includeInPdf: bool(fd, "includeInPdf"),
        });
        await log(tx, me, "activity_attachment.add", "activity_attachment", id);
        written = attachmentPath(me.organizationId, id, check.kind.ext); // berkas ditulis PALING AKHIR: gagal = baris dan audit batal
        await writeAttachment(written, clean);
      });
    } catch (err) {
      if (written) await removeAttachmentFile(written).catch(() => {});
      throw err;
    }
    revalidatePath("/records", "layout");
    return ok(id, "records.photoAdded");
  });
}

export async function updateAttachment(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    await tenantQuery(async (tx) => {
      const upd = await tx.update(activityAttachments).set({ caption: strOrNull(fd, "caption", 300), includeInPdf: bool(fd, "includeInPdf") }).where(and(eq(activityAttachments.id, id), isNull(activityAttachments.removedAt))).returning({ id: activityAttachments.id });
      if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, "activity_attachment.update", "activity_attachment", id);
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.saved");
  });
}

/** "Hapus" lampiran = disembunyikan (removed_at); berkas tetap di penyimpanan. */
export async function removeAttachment(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const id = str(fd, "id");
    if (!uuid.safeParse(id).success) throw new ActionError("records.errors.invalid");
    await tenantQuery(async (tx) => {
      const upd = await tx.update(activityAttachments).set({ removedAt: new Date() }).where(and(eq(activityAttachments.id, id), isNull(activityAttachments.removedAt))).returning({ id: activityAttachments.id });
      if (upd.length !== 1) throw new ActionError("records.errors.notAllowed");
      await log(tx, me, "activity_attachment.remove", "activity_attachment", id);
    });
    revalidatePath("/records", "layout");
    return ok(id, "records.photoRemoved");
  });
}

/** 要フォロー / 問題あり: buat kasus dari wawancara berkala (judul Jepang bawaan, pekerja disalin). */
export async function createCaseFromInterview(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (me) => {
    const interviewId = str(fd, "interviewId");
    const category = str(fd, "category") || "other";
    if (!uuid.safeParse(interviewId).success || !(CASE_CATEGORIES as readonly string[]).includes(category)) throw new ActionError("records.errors.invalid");
    let caseId = "";
    await tenantQuery(async (tx) => {
      const [iv] = await tx.select().from(periodicInterviews).where(eq(periodicInterviews.id, interviewId)).limit(1);
      if (!iv || iv.status !== "active" || !["follow_up", "issue"].includes(iv.resultStatus ?? "")) throw new ActionError("records.errors.notAllowed");
      const [c] = await tx.insert(activityCases).values({ organizationId: me.organizationId, createdBy: me.id, title: `定期面談 ${iv.periodMonth.slice(0, 7).replace("-", "/")}`, category, code: "" }).returning({ id: activityCases.id });
      caseId = c.id;
      await tx.insert(activityCaseSubjects).values({ caseId, candidateId: iv.candidateId, organizationId: me.organizationId });
      await log(tx, me, "activity_case.create", "activity_case", caseId, { category, status: "open" });
    });
    // tanpa revalidatePath: form pemanggil mengalihkan halaman (revalidasi akan melepas form sebelum pengalihan berjalan)
    return ok(caseId, "records.caseCreated");
  });
}
