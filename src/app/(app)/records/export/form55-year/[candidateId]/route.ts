import { fiscalYearOf } from "@/db/records-core";
import { allWorkers } from "@/db/records-queries";
import { UUID, auditExport, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { isConducted, toForm55Pdf, yearInterviews } from "@/features/records/form55-queries";
import { ymdIn } from "@/lib/org-time";
import { renderForm55YearPdf } from "@/lib/pdf/form55";

/** PDF gabungan: semua form 5-5 satu pekerja dalam satu tahun fiskal (hanya wawancara yang dilaksanakan), urut bulan. */
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
    const forms = (await yearInterviews(tx, candidateId, fy)).filter(isConducted).map((r) => toForm55Pdf(worker, r));
    await auditExport(tx, g.me, { exportKind: "form55_year", rows: forms.length, clientVersion: false });
    return { fy, workerName: worker.fullName, forms };
  });
  if (!data) return text(404, "Not found");
  const buf = await renderForm55YearPdf({ orgName: g.me.organizationName, tz: g.tz, now: new Date() }, data);
  return pdfResponse(buf, `form5-5-${fy}.pdf`);
}
