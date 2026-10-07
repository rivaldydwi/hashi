import { inSeries } from "@/db/serial";
import { and, eq } from "drizzle-orm";
import { allWorkers, interviewRowsFull, quarterNotes } from "@/features/records/queries";
import { UUID, auditExport, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { fiscalYearOf, quarterOfMonth } from "@/db/records-core";
import { users } from "@/db/schema";
import { ymdIn } from "@/lib/org-time";
import { renderInterviewPdf, type InterviewMonth } from "@/lib/pdf/exports";

/** PDF 定期面談 satu pekerja satu tahun fiskal (versi internal). */
export async function GET(req: Request, ctx: { params: Promise<{ candidateId: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { candidateId } = await ctx.params;
  if (!UUID.test(candidateId)) return text(404, "Not found");
  const fyParam = Number.parseInt(new URL(req.url).searchParams.get("fy") ?? "", 10);
  const fy = Number.isInteger(fyParam) && fyParam >= 2020 && fyParam <= 2100 ? fyParam : fiscalYearOf(ymdIn(new Date(), g.tz));
  const data = await withTenant(g.scope, async (tx) => {
    const worker = (await allWorkers(tx)).find((w) => w.id === candidateId);
    if (!worker) return null;
    const [rows, notes, staff] = await inSeries(
      () => interviewRowsFull(tx, fy),
      () => quarterNotes(tx, fy),
      () => tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.organizationId, g.me.organizationId))),
    );
    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const months = new Map<string, InterviewMonth>();
    for (const r of rows.filter((x) => x.candidateId === candidateId)) {
      months.set(r.periodMonth, { month: r.periodMonth, applicable: r.applicable, interviewDate: r.interviewDate, resultStatus: r.resultStatus, reason: r.reason, content: r.content, staffName: r.staffId ? (nameOf.get(r.staffId) ?? null) : null, note: r.note });
    }
    const q = new Map<number, string>();
    for (const n of notes.filter((x) => x.candidateId === candidateId && x.note)) q.set(n.quarter, n.note!);
    void quarterOfMonth;
    await auditExport(tx, g.me, { exportKind: "periodic_interview", rows: months.size, clientVersion: false });
    const pic = worker.contacts[0];
    return {
      fy, rows: months, quarterNotes: q,
      worker: { name: worker.fullName, field: worker.fieldNameJa, startDate: worker.startDate, company: worker.companyName, address: worker.siteAddress, phone: worker.sitePhone, pic: pic ? `${pic.name}${pic.phone ? `（${pic.phone}）` : ""}` : null },
    };
  });
  if (!data) return text(404, "Not found");
  const buf = await renderInterviewPdf({ orgName: g.me.organizationName, tz: g.tz, now: new Date() }, data);
  return pdfResponse(buf, `teiki-mendan-${fy}.pdf`);
}
