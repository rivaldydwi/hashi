import { loadRecordForPdf } from "@/features/records/export-data";
import { UUID, auditExport, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { renderRecordPdf } from "@/lib/pdf/exports";

/** PDF satu catatan (① atau ②), versi internal: memuat pembatalan dan foto yang ditandai "sertakan di PDF". */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return text(404, "Not found");
  const rec = await withTenant(g.scope, async (tx) => {
    const r = await loadRecordForPdf(tx, g.me.organizationId, id);
    if (r) await auditExport(tx, g.me, { exportKind: "record", rows: 1, clientVersion: false });
    return r;
  });
  if (!rec) return text(404, "Not found");
  const buf = await renderRecordPdf({ orgName: g.me.organizationName, tz: g.tz, now: new Date() }, rec);
  const day = (rec.kind === "daily_work" ? rec.data.date : rec.data.startedAt.toISOString().slice(0, 10));
  return pdfResponse(buf, `${rec.kind === "daily_work" ? "gyomu-kiroku" : "gijiroku"}-${day}.pdf`);
}
