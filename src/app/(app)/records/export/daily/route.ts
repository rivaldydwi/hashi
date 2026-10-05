import { loadDailyForPdf } from "@/features/records/export-data";
import { UUID, auditExport, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { renderDailyReportPdf } from "@/lib/pdf/exports";

/** PDF laporan harian: semua ① pada satu tanggal (opsional satu staf), berurutan, masing-masing dalam tabel format ①. */
export async function GET(req: Request) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const staff = url.searchParams.get("staff") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (staff && !UUID.test(staff))) return text(400, "Bad request");
  const data = await withTenant(g.scope, async (tx) => {
    const d = await loadDailyForPdf(tx, g.me.organizationId, date, staff || null);
    if (d.records.length) await auditExport(tx, g.me, { exportKind: "daily_report", rows: d.records.length, clientVersion: false });
    return d;
  });
  if (data.records.length === 0) return text(404, "Not found");
  const buf = await renderDailyReportPdf({ orgName: g.me.organizationName, tz: g.tz, now: new Date() }, { date, staffName: data.staffName, records: data.records });
  return pdfResponse(buf, `gyomu-kiroku-${date}.pdf`);
}
