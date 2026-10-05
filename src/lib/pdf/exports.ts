// Penyusun isi PDF Catatan kegiatan dari data yang SUDAH disiapkan (tanpa DB), supaya mudah dites. Semua label dari labels.ja.ts.
import { fiscalMonths, fiscalTitle, quarterOfMonth, type MeetingSections } from "@/db/records-core";
import { PdfBuilder } from "./core";
import { jaDateTime, jaDay } from "./dates";
import { PDF } from "./labels.ja";

export type PdfCtx = { orgName: string; tz: string; now: Date };
export type Photo = { data: Buffer; caption: string | null };

export type DailyData = {
  date: string; authorName: string; subjects: string[]; site: string | null; workType: string | null; workTypeOther: string | null;
  actionTaken: string | null; result: string | null; pending: string | null; nextAction: string | null; reportTo: string; note: string | null;
  status: string; voidReason: string | null; photos: Photo[];
};
export type MeetingData = {
  subject: string; startedAt: Date; endedAt: Date | null; subjects: string[]; handlers: string[]; method: string | null; sections: MeetingSections;
  status: string; voidReason: string | null; photos: Photo[];
};

const SECTION_ORDER = ["consultation", "workerView", "currentStatus", "actionTaken", "nextAction", "shared", "pending"] as const;

function dailyRows(d: DailyData, withAuthor = true): Array<[string, string]> {
  const L = PDF.daily;
  const work = d.workType === "other" && d.workTypeOther ? d.workTypeOther : (PDF.workTypes[d.workType ?? "other"] ?? "");
  return [
    [L.date, jaDay(d.date)],
    ...(withAuthor ? ([[L.author, d.authorName]] as Array<[string, string]>) : []),
    [L.subjects, d.subjects.join("、")],
    [L.site, d.site ?? ""],
    [L.workType, work],
    [L.actionTaken, d.actionTaken ?? ""],
    [L.result, d.result ?? ""],
    [L.pending, d.pending ?? ""],
    [L.nextAction, d.nextAction ?? ""],
    [L.reportTo, d.reportTo],
    [L.note, d.note ?? ""],
  ];
}

function drawDaily(b: PdfBuilder, d: DailyData) {
  if (d.status === "void") b.banner(`${PDF.common.void}: ${d.voidReason ?? ""}`);
  b.kv(dailyRows(d));
  drawPhotos(b, d.photos);
}

function drawPhotos(b: PdfBuilder, photos: Photo[]) {
  if (photos.length === 0) return;
  b.h2(PDF.common.photo);
  for (const p of photos) b.image(p.data, p.caption);
}

function drawMeeting(b: PdfBuilder, ctx: PdfCtx, m: MeetingData) {
  b.title(`${PDF.meeting.subject}: ${m.subject}`, PDF.meeting.title);
  if (m.status === "void") b.banner(`${PDF.common.void}: ${m.voidReason ?? ""}`);
  const when = m.endedAt ? `${jaDateTime(m.startedAt, ctx.tz)} 〜 ${jaDateTime(m.endedAt, ctx.tz)}` : jaDateTime(m.startedAt, ctx.tz);
  b.kv([
    [PDF.meeting.when, when],
    [PDF.meeting.subjects, m.subjects.join("、")],
    [PDF.meeting.handlers, m.handlers.join("、")],
    [PDF.meeting.placeMethod, m.method ? (PDF.methods[m.method] ?? "") : ""],
  ]);
  // bagian kosong dilewati; penomoran mengikuti yang tampil
  let n = 0;
  SECTION_ORDER.forEach((k, i) => {
    const items = m.sections[k];
    if (!items?.length) return;
    n++;
    b.h2(`${n}. ${PDF.meeting.sections[i]}`);
    for (const it of items) b.para(`・${it}`);
  });
  drawPhotos(b, m.photos);
}

export async function renderRecordPdf(ctx: PdfCtx, rec: { kind: "daily_work"; data: DailyData } | { kind: "meeting"; data: MeetingData }): Promise<Buffer> {
  const title = rec.kind === "daily_work" ? PDF.daily.title : PDF.meeting.title;
  const b = new PdfBuilder({ orgName: ctx.orgName, headerRight: title, createdAt: jaDateTime(ctx.now, ctx.tz), title });
  if (rec.kind === "daily_work") {
    b.title(`${PDF.daily.title} ${jaDay(rec.data.date)}`);
    drawDaily(b, rec.data);
  } else drawMeeting(b, ctx, rec.data);
  return b.finish();
}

export async function renderDailyReportPdf(ctx: PdfCtx, p: { date: string; staffName: string | null; records: DailyData[] }): Promise<Buffer> {
  const title = `${PDF.daily.title} ${jaDay(p.date)}`;
  const b = new PdfBuilder({ orgName: ctx.orgName, headerRight: PDF.daily.title, createdAt: jaDateTime(ctx.now, ctx.tz), title });
  b.title(title, p.staffName ? `${PDF.daily.author}: ${p.staffName}` : undefined);
  p.records.forEach((r, i) => {
    if (i > 0) b.doc.moveDown(0.6);
    drawDaily(b, r);
  });
  return b.finish();
}

export type CaseEventData = { occurredAt: Date; timeKnown: boolean; event: string; subjectStatement: string | null; companyResponse: string | null; note: string | null; status: string; voidReason: string | null; creatorName: string };
export type CaseData = { code: string; title: string; category: string; status: string; openedAt: Date; subjects: string[]; site: string | null };

/**
 * 時系列. mode "internal": semua baris (yang dibatalkan bertanda), nama penyusun, kode kasus. mode "client": hanya baris yang dipilih
 * (penyaringan dilakukan pemanggil), TANPA nama staf penyusun dan TANPA kode kasus internal; 備考 hanya bila `includeNotes`.
 */
export async function renderCasePdf(ctx: PdfCtx, p: { mode: "internal" | "client"; includeNotes: boolean; kase: CaseData; events: CaseEventData[] }): Promise<Buffer> {
  const L = PDF.timeline;
  const client = p.mode === "client";
  const b = new PdfBuilder({ orgName: ctx.orgName, headerRight: L.title, createdAt: jaDateTime(ctx.now, ctx.tz), title: `${L.title} ${p.kase.title}` });
  b.title(L.title);
  b.kv([
    [L.caseTitle, p.kase.title],
    ...(client ? [] : ([[L.caseCode, p.kase.code]] as Array<[string, string]>)),
    [L.category, PDF.categories[p.kase.category] ?? ""],
    [L.subjects, p.kase.subjects.join("、")],
    [L.site, p.kase.site ?? ""],
    ...(client ? [] : ([[L.status, PDF.caseStatus[p.kase.status] ?? ""]] as Array<[string, string]>)),
    [L.opened, jaDateTime(p.kase.openedAt, ctx.tz, false)],
  ]);
  const withNote = !client || p.includeNotes;
  const cols = [{ header: L.when, width: 80 }, { header: L.event, width: 150 }, { header: L.subjectStatement, width: 130 }, { header: L.companyResponse, width: 130 }, ...(withNote ? [{ header: L.note, width: 90 }] : [])];
  const rows = p.events.map((e) => {
    const void_ = e.status === "void";
    const when = jaDateTime(e.occurredAt, ctx.tz, e.timeKnown) + (client ? "" : `\n（${L.writtenBy}: ${e.creatorName}）`);
    const event = void_ ? `【${PDF.common.void}】${e.voidReason ?? ""}\n${e.event}` : e.event;
    const cells = [when, event, e.subjectStatement ?? "", e.companyResponse ?? "", ...(withNote ? [e.note ?? ""] : [])];
    return { cells, muted: void_ };
  });
  b.table(cols, rows);
  return b.finish();
}

export type InterviewMonth = { month: string; applicable: boolean; interviewDate: string | null; resultStatus: string | null; reason: string | null; content: string | null; staffName: string | null; note: string | null } | null;
export type WorkerPdf = { name: string; field: string | null; startDate: string; company: string; address: string | null; phone: string | null; pic: string | null };

export async function renderInterviewPdf(ctx: PdfCtx, p: { fy: number; worker: WorkerPdf; rows: Map<string, InterviewMonth>; quarterNotes: Map<number, string> }): Promise<Buffer> {
  const L = PDF.periodic;
  const title = `${L.title} ${fiscalTitle(p.fy)}`;
  const b = new PdfBuilder({ orgName: ctx.orgName, headerRight: L.title, createdAt: jaDateTime(ctx.now, ctx.tz), title });
  b.title(title);
  b.kv([
    [L.name, p.worker.name],
    [L.field, p.worker.field ?? ""],
    [L.startDate, p.worker.startDate.replace(/-/g, "/")],
    [L.company, p.worker.company],
    [L.address, p.worker.address ?? ""],
    [L.phone, p.worker.phone ?? ""],
    [L.pic, p.worker.pic ?? ""],
  ], 130);
  const cols = [{ header: L.month, width: 40 }, { header: L.date, width: 62 }, { header: L.status, width: 62 }, { header: L.content, width: 200 }, { header: L.reason, width: 70 }, { header: L.staff, width: 60 }];
  const rows: Array<{ cells: string[]; muted?: boolean; shade?: boolean; span?: boolean }> = [];
  fiscalMonths(p.fy).forEach((m, i) => {
    const r = p.rows.get(m) ?? null;
    const label = `${Number(m.slice(5, 7))}月`;
    if (r && !r.applicable) rows.push({ cells: [label, L.notApplicable, "", r.note ?? "", "", ""], muted: true });
    else if (r) rows.push({ cells: [label, r.interviewDate?.replace(/-/g, "/") ?? "", r.resultStatus ? PDF.results[r.resultStatus] : "", [r.content, r.note ? `（${L.note}: ${r.note}）` : ""].filter(Boolean).join("\n"), r.reason ? PDF.reasons[r.reason] : "", r.staffName ?? ""] });
    else rows.push({ cells: [label, "", "", "", "", ""], muted: true });
    if (i % 3 === 2) {
      const q = quarterOfMonth(m);
      rows.push({ cells: [`${L.quarterNote(q)}: ${p.quarterNotes.get(q) ?? ""}`], shade: true, span: true });
    }
  });
  b.table(cols, rows);
  return b.finish();
}
