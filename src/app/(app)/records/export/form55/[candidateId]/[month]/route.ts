import { summarizeForm55 } from "@/db/form55";
import { allWorkers } from "@/db/records-queries";
import { UUID, auditExport, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { yearInterviews, toForm55Pdf } from "@/features/records/form55-queries";
import { fiscalYearOf } from "@/db/records-core";
import { renderForm55Pdf } from "@/lib/pdf/form55";

/** PDF 参考様式第5-5号 untuk SATU wawancara berkala (pekerja + bulan). Hanya staf TSK; wawancara yang tidak ada = 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ candidateId: string; month: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { candidateId, month } = await ctx.params;
  if (!UUID.test(candidateId) || !/^\d{4}-\d{2}-01$/.test(month)) return text(404, "Not found");
  const data = await withTenant(g.scope, async (tx) => {
    const worker = (await allWorkers(tx)).find((w) => w.id === candidateId);
    if (!worker) return null;
    const row = (await yearInterviews(tx, candidateId, fiscalYearOf(month))).find((r) => r.month === month && r.applicable);
    if (!row) return null;
    await auditExport(tx, g.me, { exportKind: summarizeForm55(row.form).nonconformity ? "form55_nonconformity" : "form55", rows: 1, clientVersion: false });
    return toForm55Pdf(worker, row);
  });
  if (!data) return text(404, "Not found");
  const buf = await renderForm55Pdf({ orgName: g.me.organizationName, tz: g.tz, now: new Date() }, data);
  return pdfResponse(buf, `form5-5-${month.slice(0, 7)}.pdf`);
}
