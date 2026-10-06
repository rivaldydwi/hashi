import { loadJobOrderSheet } from "@/features/client-sheet/queries";
import { auditSheetExport, parseSheetParams, sheetFilename } from "@/features/client-sheet/route";
import { UUID, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { buildJobOrderSheet } from "@/lib/pdf/client-sheet-model";
import { renderSheetPdf } from "@/lib/pdf/client-sheet";

/**
 * PDF 求人票 (lembar job order). Hanya TSK_ADMIN/TSK_STAFF (LPK dan lainnya 404). `mode=share` WAJIB `confirm=1`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const p = parseSheetParams(url);
  if (!UUID.test(id)) return text(404, "Not found");
  if (!p) return text(400, "Parameter tidak valid");
  if (p.mode === "share" && !p.confirmed) return text(400, "Konfirmasi pemeriksaan isi wajib");
  const data = await withTenant(g.scope, (tx) => loadJobOrderSheet(tx, id));
  if (!data) return text(404, "Not found");
  const now = new Date();
  const sheet = buildJobOrderSheet(data, { mode: p.mode, lang: p.lang, preparedBy: g.me.name });
  const { buf, pages } = await renderSheetPdf({ orgName: g.me.organizationName, tz: g.tz, now }, sheet);
  await withTenant(g.scope, (tx) => auditSheetExport(tx, g.me, { kind: "jobOrder", mode: p.mode, lang: p.lang, pages }));
  return pdfResponse(buf, sheetFilename("jobOrder", now));
}
