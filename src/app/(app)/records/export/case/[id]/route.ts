import { loadCaseForPdf } from "@/features/records/export-data";
import { UUID, auditExport, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { renderCasePdf } from "@/lib/pdf/exports";

/**
 * PDF 時系列 satu kasus. mode=internal: semua baris (termasuk yang dibatalkan), nama penyusun, kode kasus.
 * mode=client: hanya baris aktif yang ikut ekspor klien, tanpa nama staf dan tanpa kode internal; `notes=0` menghilangkan kolom 備考.
 * Versi klien WAJIB `confirm=1` (konfirmasi dari halaman pratinjau); tanpa itu 400.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return text(404, "Not found");
  const url = new URL(req.url);
  const client = url.searchParams.get("mode") === "client";
  if (client && url.searchParams.get("confirm") !== "1") return text(400, "Konfirmasi pemeriksaan isi wajib");
  const includeNotes = url.searchParams.get("notes") !== "0";
  const data = await withTenant(g.scope, async (tx) => {
    const d = await loadCaseForPdf(tx, id);
    if (!d) return null;
    const events = client ? d.events.filter((e) => e.status === "active" && e.includeInClientExport) : d.events;
    await auditExport(tx, g.me, { exportKind: "case_timeline", rows: events.length, clientVersion: client });
    return { kase: d.kase, events };
  });
  if (!data) return text(404, "Not found");
  const buf = await renderCasePdf({ orgName: g.me.organizationName, tz: g.tz, now: new Date() }, { mode: client ? "client" : "internal", includeNotes, kase: data.kase, events: data.events });
  const stamp = new Date().toISOString().slice(0, 10);
  // nama berkas versi klien TIDAK memuat kode kasus internal
  return pdfResponse(buf, client ? `jikeiretsu-${stamp}.pdf` : `jikeiretsu-${data.kase.code}-${stamp}.pdf`);
}
