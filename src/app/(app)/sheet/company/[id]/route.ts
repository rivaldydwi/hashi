import { loadCompanySheet } from "@/features/client-sheet/queries";
import { auditSheetExport, parseSheetParams, sheetFilename } from "@/features/client-sheet/route";
import { UUID, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { buildCompanySheet } from "@/lib/pdf/client-sheet-model";
import { renderSheetPdf } from "@/lib/pdf/client-sheet";

/**
 * PDF 取引先プロフィール (profil klien). Hanya TSK_ADMIN/TSK_STAFF (LPK dan lainnya 404). `mode=share` WAJIB `confirm=1`;
 * `site=<uuid>` (opsional) membatasi ke satu lokasi (tombol di halaman lokasi).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const siteId = url.searchParams.get("site") ?? undefined;
  const p = parseSheetParams(url);
  if (!UUID.test(id) || (siteId && !UUID.test(siteId))) return text(404, "Not found");
  if (!p) return text(400, "Parameter tidak valid");
  if (p.mode === "share" && !p.confirmed) return text(400, "Konfirmasi pemeriksaan isi wajib");
  const data = await withTenant(g.scope, (tx) => loadCompanySheet(tx, id, siteId));
  if (!data) return text(404, "Not found");
  const now = new Date();
  const sheet = buildCompanySheet(data, { mode: p.mode, lang: p.lang, preparedBy: g.me.name });
  const { buf, pages } = await renderSheetPdf({ orgName: g.me.organizationName, tz: g.tz, now }, sheet);
  await withTenant(g.scope, (tx) => auditSheetExport(tx, g.me, { kind: "company", mode: p.mode, lang: p.lang, pages }));
  return pdfResponse(buf, sheetFilename("company", now));
}
