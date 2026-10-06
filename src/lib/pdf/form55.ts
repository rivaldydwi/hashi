// PDF 参考様式第5-5号 定期面談報告書（1号特定技能外国人用）: satu form per wawancara, dan gabungan setahun fiskal per pekerja (T-009).
// Isi disusun dari data yang SUDAH disiapkan (tanpa DB) supaya mudah dites. Label tetap di labels.ja.ts; butir (①〜⑤) di src/db/form55.ts.
import { FORM55_GROUPS, type Form55 } from "@/db/form55";
import { fiscalTitle } from "@/db/records-core";
import { PdfBuilder, jaDateTime } from "./core";
import type { PdfCtx } from "./exports";
import { PDF } from "./labels.ja";

export type Form55PdfData = {
  workerName: string;
  /** 特定技能所属機関 = perusahaan penerima (配属先). */
  orgName: string;
  /** Tanggal wawancara "YYYY-MM-DD" atau null. */
  interviewDate: string | null;
  method: string | null;
  responderName: string | null;
  responderRole: string | null;
  responderTitle: string | null;
  form: Form55 | null;
};

const L = PDF.form55;
const ymd = (v: string | null | undefined) => (v ? v.replace(/-/g, "/") : "");
const box = (on: boolean, label: string) => `${on ? "■" : "□"} ${label}`;

function responseRows(f: Form55): Array<[string, string]> {
  const r = f.response;
  if (!r) return [];
  const done = (v: "done" | "not_done" | null) => (v === "done" ? L.done : v === "not_done" ? L.notDone : "");
  const worker = r.worker.kind === "referred" ? `${L.referred}（${L.body}: ${r.worker.body}）` : r.worker.kind === "none" ? `${L.noAction}（${L.reason}: ${r.worker.reason}）` : "";
  const notify = r.company.notified === "done" ? `${L.done}（${ymd(r.company.notifiedOn)} / ${L.to}: ${r.company.notifiedTo}）` : r.company.notified === "not_done" ? `${L.notDone}（${L.reason}: ${r.company.notifiedReason}）` : "";
  const imm = [done(r.company.immigration), r.company.immigrationNote].filter(Boolean).join("　");
  const agency = r.agency.reported === "done" ? `${L.done}（${ymd(r.agency.on)} / ${L.body}: ${r.agency.body}）` : r.agency.reported === "not_done" ? `${L.notDone}（${L.reason}: ${r.agency.reason}）` : "";
  return [
    [L.occurredOn, ymd(r.occurredOn)],
    [L.content, r.content],
    [`${L.handling} ${L.toWorker}`, worker],
    [`${L.toCompany} ${L.notifyManager}`, notify],
    [`${L.toCompany} ${L.immigration}`, imm],
    [`${L.toAgency}`, agency],
  ];
}

/** Gambar SATU form di halaman berjalan (mulai dari y sekarang). */
export function drawForm55(b: PdfBuilder, d: Form55PdfData) {
  const f = d.form;
  b.title(L.title, L.formNo);
  b.h2(L.s1);
  b.kv([[L.name, d.workerName], [L.org, d.orgName], [L.date, ymd(d.interviewDate)], [L.method, `${box(d.method === "in_person", L.methods.in_person)}　${box(d.method === "online", L.methods.online)}`]], 150);
  b.h2(L.s2);
  b.kv([[L.responder, d.responderName ?? ""], [L.position, `${box(d.responderRole === "support_manager", L.roles.support_manager)}　${box(d.responderRole === "support_staff", L.roles.support_staff)}　${d.responderTitle ?? ""}`]], 150);
  b.h2(L.s3);
  const rows: Array<{ cells: string[]; muted?: boolean; shade?: boolean; span?: boolean }> = [];
  for (const g of FORM55_GROUPS) {
    rows.push({ cells: [`${g.no} ${g.ja}`], shade: true, span: true });
    g.items.forEach((it, i) => {
      const a = f?.items[it.code];
      rows.push({ cells: [`(${i + 1}) ${it.ja}`, a ? (a.a === "problem" ? L.has : L.none) : "", a?.text ?? ""] });
    });
  }
  b.table([{ header: L.colItem, width: 260 }, { header: L.colHas, width: 56 }, { header: L.colText, width: 200 }], rows);
  b.kv([[L.nonconformity, f?.nonconformity === true ? L.has : f?.nonconformity === false ? "なし" : ""], [L.special, f?.special ?? ""]], 150);
  if (f?.nonconformity === true) {
    b.h2(L.s4);
    b.kv(responseRows(f), 150);
  }
  b.kv([[L.createdOn, ymd(f?.createdOn ?? d.interviewDate)], [L.interviewer, d.responderName ?? ""]], 150);
}

export async function renderForm55Pdf(ctx: PdfCtx, d: Form55PdfData): Promise<Buffer> {
  const b = new PdfBuilder({ orgName: ctx.orgName, headerRight: L.formNo, createdAt: jaDateTime(ctx.now, ctx.tz), title: `${L.title} ${d.workerName}` });
  drawForm55(b, d);
  return b.finish();
}

/** Semua form 5-5 satu pekerja dalam satu tahun fiskal, urut bulan, satu form per halaman (atau lebih). */
export async function renderForm55YearPdf(ctx: PdfCtx, p: { fy: number; workerName: string; forms: Form55PdfData[] }): Promise<Buffer> {
  const title = L.yearTitle(fiscalTitle(p.fy));
  const b = new PdfBuilder({ orgName: ctx.orgName, headerRight: L.formNo, createdAt: jaDateTime(ctx.now, ctx.tz), title: `${title} ${p.workerName}` });
  p.forms.forEach((f, i) => {
    if (i > 0) b.doc.addPage();
    drawForm55(b, f);
  });
  if (p.forms.length === 0) b.para(PDF.common.none);
  return b.finish();
}
