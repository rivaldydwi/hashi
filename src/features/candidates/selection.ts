import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { candidateSelections, jobOrders, type SelectionDecision } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode, PG_CHECK_VIOLATION } from "@/lib/errors";
import type { CurrentUser } from "@/lib/session";
import { auditTsk } from "@/features/clients/audit";
import { JOB_ORDER_REQUIRED_DECISIONS } from "./permissions";

/**
 * Tulis keputusan TSK untuk satu "lingkup": umum (jobOrderId null) atau satu job order. Dipakai form keputusan dan tombol "Ajukan".
 * Aturan: keputusan di JOB_ORDER_REQUIRED_DECISIONS wajib punya job order; job order harus milik TSK ini dan sebidang dengan kandidat.
 * Audit: di log LPK pemilik kandidat hanya nilai keputusan (LPK tidak boleh tahu job order); id job order dicatat di log TSK.
 * Mengembalikan false bila tidak ada perubahan.
 */
export async function upsertSelection(
  tx: Tx,
  me: CurrentUser,
  cand: { id: string; organizationId: string; fieldId: string | null },
  decision: SelectionDecision,
  jobOrderId: string | null,
): Promise<boolean> {
  if (JOB_ORDER_REQUIRED_DECISIONS.includes(decision) && !jobOrderId) throw new ActionError("detail.errors.jobOrderRequired");
  if (jobOrderId) {
    const [jo] = await tx.select({ fieldId: jobOrders.fieldId }).from(jobOrders).where(eq(jobOrders.id, jobOrderId)).limit(1);
    if (!jo) throw new ActionError("detail.errors.jobOrderInvalid"); // tidak ada atau milik TSK lain (RLS)
    if (jo.fieldId !== cand.fieldId) throw new ActionError("detail.errors.jobOrderFieldMismatch");
  }
  const scope = and(
    eq(candidateSelections.candidateId, cand.id),
    eq(candidateSelections.tskOrgId, me.organizationId),
    jobOrderId ? eq(candidateSelections.jobOrderId, jobOrderId) : isNull(candidateSelections.jobOrderId),
  );
  const [existing] = await tx.select({ decision: candidateSelections.decision }).from(candidateSelections).where(scope).limit(1);
  const before = existing?.decision ?? "NONE";
  if (before === decision) return false;
  let rowId: string;
  try {
    const [done] = await tx
      .insert(candidateSelections)
      .values({ candidateId: cand.id, tskOrgId: me.organizationId, jobOrderId, decision, decidedBy: me.id })
      .onConflictDoUpdate({
        target: [candidateSelections.candidateId, candidateSelections.tskOrgId, candidateSelections.jobOrderId],
        set: { decision, decidedBy: me.id, decidedAt: new Date() },
      })
      .returning({ id: candidateSelections.id });
    if (!done) throw new ActionError("detail.errors.readOnly");
    rowId = done.id;
  } catch (err) {
    if (err instanceof ActionError) throw err;
    const msg = String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message);
    if (pgErrorCode(err) === PG_CHECK_VIOLATION && /penempatan aktif/.test(msg)) throw new ActionError("detail.errors.alreadyPlaced");
    throw err;
  }
  await audit(tx, {
    organizationId: cand.organizationId,
    actorOrgId: me.organizationId,
    candidateId: cand.id,
    actorUserId: me.id,
    action: "candidate.decision",
    entity: "candidate_selection",
    entityId: rowId,
    before: { decision: before },
    after: { decision },
  });
  if (jobOrderId) await auditTsk(tx, me, "selection.job_order", "candidate_selection", rowId, ["decision"], cand.id);
  return true;
}
