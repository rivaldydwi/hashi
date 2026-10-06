// PDF 参考様式第5－5号 定期面談報告書（1号特定技能外国人用）: satu form per wawancara, dan gabungan setahun fiskal per pekerja (T-009).
// Isi disusun dari data yang SUDAH disiapkan (tanpa DB) supaya mudah dites. Label tetap di labels.ja.ts (teks resmi form); butir (①〜⑤) di src/db/form55.ts.
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
  /** Tanggal form TERAKHIR DISIMPAN (zona waktu TSK, "YYYY-MM-DD"): dipakai untuk 作成年月日 bila tidak diisi eksplisit. */
  savedOn: string | null;
};

const L = PDF.form55;
const ymd = (v: string | null | undefined) => (v ? v.replace(/-/g, "/") : "");
const box = (on: boolean, label: string) => `${on ? "■" : "□"}${label}`;
const paren = (parts: Array<[string, string | null | undefined]>) => {
  const t = parts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" / ");
  return t ? `（${t}）` : "";
};

function responseRows(f: Form55): Array<[string, string]> {
  const r = f.response;
  if (!r) return [];
  const w = r.worker, c = r.company, a = r.agency;
  return [
    [L.occurredOn, ymd(r.occurredOn)],
    [L.content, r.content],
    [`${L.handling}\n${L.toWorker}`, `${box(w.kind === "referred", L.referred)}${w.kind === "referred" ? paren([[L.referredBody, w.body]]) : ""}\n${box(w.kind === "none", L.noAction)}${w.kind === "none" ? paren([[L.reason, w.reason]]) : ""}`],
    [`${L.toCompany}\n${L.notify}`, `${box(c.notified === "done", L.notified)}${c.notified === "done" ? paren([[L.notifiedOn, ymd(c.notifiedOn)], [L.notifiedTo, c.notifiedTo]]) : ""}\n${box(c.notified === "not_done", L.notNotified)}${c.notified === "not_done" ? paren([[L.reason, c.notifiedReason]]) : ""}`],
    [`${L.toCompany}\n${L.immigration}`, `${box(c.immigration === "done", L.guided)}　${box(c.immigration === "not_done", L.notGuided)}${c.immigrationNote ? `（${c.immigrationNote}）` : ""}`],
    [L.toAgency, `${box(a.reported === "done", L.reported)}${a.reported === "done" ? paren([[L.reportedOn, ymd(a.on)], [L.reportedBody, a.body]]) : ""}\n${box(a.reported === "not_done", L.notReported)}${a.reported === "not_done" ? paren([[L.reason, a.reason]]) : ""}`],
  ];
}

/** Gambar SATU form di halaman berjalan (mulai dari y sekarang). */
export function drawForm55(b: PdfBuilder, d: Form55PdfData) {
  const f = d.form;
  b.title(L.title);
  b.h2(L.s1);
  b.kv([[L.name, d.workerName], [L.org, d.orgName], [L.date, ymd(d.interviewDate)], [L.method, `${box(d.method === "in_person", L.methods.in_person)}　${box(d.method === "online", L.methods.online)}`]], 170);
  b.h2(L.s2);
  b.kv([[L.responder, d.responderName ?? ""], [L.position, `${box(d.responderRole === "support_manager", L.roles.support_manager)}　${box(d.responderRole === "support_staff", L.roles.support_staff)}`], [L.positionTitle, d.responderTitle ?? ""]], 170);
  b.h2(L.s3);
  const rows: Array<{ cells: string[]; muted?: boolean; shade?: boolean; span?: boolean }> = [];
  for (const g of FORM55_GROUPS) {
    g.items.forEach((it, i) => {
      const a = f?.items[it.code];
      const text = it.code === "other.2" ? L.otherItem(f?.otherLabel ?? "") : it.ja;
      rows.push({ cells: [i === 0 ? `${g.no}${g.ja}` : "", `(${i + 1}) ${text}`, `${box(a?.a === "problem", L.has)}　${box(a?.a === "ok", L.none)}`, a?.text ?? ""] });
    });
  }
  b.table([{ header: L.colItem, width: 80 }, { header: L.colContent, width: 190 }, { header: L.colHas, width: 66 }, { header: L.colText, width: 150 }], rows);
  b.kv([[L.nonconformity, `${box(f?.nonconformity === true, L.ncYes)}　${box(f?.nonconformity === false, L.ncNo)}`], [L.special, f?.special ?? ""]], 170);
  if (f?.nonconformity === true) {
    b.h2(L.s4);
    b.kv(responseRows(f), 170);
  }
  b.kv([[L.createdOn, ymd(f?.createdOn ?? d.savedOn)], [L.interviewer, d.responderName ?? ""]], 170);
}

/** Header kiri atas = nomor form resmi; nama organisasi kecil di kanan. */
const builder = (ctx: PdfCtx, title: string) => new PdfBuilder({ orgName: L.formNo, headerRight: ctx.orgName, createdAt: jaDateTime(ctx.now, ctx.tz), title });

export async function renderForm55Pdf(ctx: PdfCtx, d: Form55PdfData): Promise<Buffer> {
  const b = builder(ctx, `${L.title} ${d.workerName}`);
  drawForm55(b, d);
  return b.finish();
}

/** Semua form 5-5 satu pekerja dalam satu tahun fiskal, urut bulan, satu form per halaman (atau lebih). */
export async function renderForm55YearPdf(ctx: PdfCtx, p: { fy: number; workerName: string; forms: Form55PdfData[] }): Promise<Buffer> {
  const b = builder(ctx, `${L.yearTitle(fiscalTitle(p.fy))} ${p.workerName}`);
  p.forms.forEach((f, i) => {
    if (i > 0) b.doc.addPage();
    drawForm55(b, f);
  });
  if (p.forms.length === 0) b.para(PDF.common.none);
  return b.finish();
}
