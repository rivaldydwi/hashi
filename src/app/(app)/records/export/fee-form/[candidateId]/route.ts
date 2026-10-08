import { eq } from "drizzle-orm";
import { passportName } from "@/db/renewal";
import { candidates } from "@/db/schema";
import { cardLog } from "@/features/cards/guards";
import { cardEditAccess } from "@/features/cards/queries";
import { UUID, pdfResponse, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { renderFeeFormPdf } from "@/lib/pdf/fee-form";
import { ymdIn } from "@/lib/org-time";

/**
 * 手数料納付書 (別記第八十四号様式) untuk pengajuan di LOKET (T-026): PDF resmi kosong + nama pekerja (romaji) + lingkaran pada nomor 2 (在留期間の更新許可).
 * Hanya 担当 efektif + TSK_ADMIN (selain itu, termasuk staf TSK lain, LPK, sensei: 404). Dicatat di audit (`residence_card.fee_form_export`, tanpa nilai) SEBELUM PDF dibuat.
 * Nama file tetap (tanpa nama pekerja). Pengajuan ONLINE tidak memakai formulir ini (sejak 2026-10-01 bayar via konbini/bank).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ candidateId: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { candidateId } = await ctx.params;
  if (!UUID.test(candidateId)) return text(404, "Not found");
  const today = ymdIn(new Date(), g.tz);
  const fullName = await withTenant(g.scope, async (tx) => {
    const access = await cardEditAccess(tx, g.me, candidateId, today);
    if (!access.canEdit || !access.activeWorker) return null;
    const [c] = await tx.select({ fullName: candidates.fullName }).from(candidates).where(eq(candidates.id, candidateId)).limit(1);
    if (!c) return null;
    await cardLog(tx, g.me, "residence_card.fee_form_export", candidateId, { status: "active" });
    return c.fullName;
  });
  if (!fullName) return text(404, "Not found");
  const pdf = await renderFeeFormPdf({ nameRomaji: passportName(fullName).full });
  return pdfResponse(pdf, "tesuryo-nofusho-loket.pdf");
}
