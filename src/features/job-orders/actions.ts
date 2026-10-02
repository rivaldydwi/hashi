"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { candidateSelections, clientSites, jobOrders, jobOrderStatus, placements } from "@/db/schema";
import { ActionError, pgErrorCode, PG_CHECK_VIOLATION } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery } from "@/lib/session";
import { buildSchema, changedFields } from "@/features/candidates/sections";
import { getCandidateForAction } from "@/features/candidates/detail-queries";
import { assertSkillFieldUsable } from "@/features/candidates/guards";
import { upsertSelection } from "@/features/candidates/selection";
import { auditTsk } from "@/features/clients/audit";
import { requireAdminAction, requireTskAction, uuid } from "@/features/clients/guards";
import { JOB_ORDER_FIELDS, PLACEMENT_FIELDS } from "./fields";

const FK_VIOLATION = "23503";
type Values = Record<string, unknown>;

async function guarded(fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    throw err;
  }
}
const dbMessage = (err: unknown) => String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message);
const filled = (values: Values) => JOB_ORDER_FIELDS.filter((f) => values[f.name] !== null && values[f.name] !== undefined && values[f.name] !== false).map((f) => f.name);

// ---------------------------------------------------------------------------------------------- Job order

export async function createJobOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  let id = "";
  const res = await guarded(async () => {
    const me = await requireTskAction();
    const siteId = uuid.safeParse(formData.get("siteId"));
    const parsed = buildSchema(JOB_ORDER_FIELDS).safeParse(Object.fromEntries(formData));
    if (!siteId.success || !parsed.success) return { status: "error", key: "jobOrders.errors.invalid" };
    const values = parsed.data as Values;
    try {
      id = await tenantQuery(async (tx) => {
        const [site] = await tx.select({ id: clientSites.id, active: clientSites.active }).from(clientSites).where(eq(clientSites.id, siteId.data));
        if (!site || !site.active) throw new ActionError("jobOrders.errors.siteInvalid");
        await assertSkillFieldUsable(tx, values.fieldId);
        const [row] = await tx
          .insert(jobOrders)
          .values({ ...(values as object), orgId: me.organizationId, siteId: siteId.data } as typeof jobOrders.$inferInsert)
          .returning({ id: jobOrders.id });
        await auditTsk(tx, me, "job_order.create", "job_order", row.id, filled(values));
        return row.id;
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_CHECK_VIOLATION && /bidang job order/.test(dbMessage(err))) return { status: "error", key: "jobOrders.errors.fieldNotAccepted" };
      throw err;
    }
    return { status: "success", key: "jobOrders.saved" };
  });
  if (res.status === "success") {
    revalidatePath("/job-orders");
    redirect(`/job-orders/${id}`);
  }
  return res;
}

export async function updateJobOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const id = uuid.safeParse(formData.get("jobOrderId"));
    const parsed = buildSchema(JOB_ORDER_FIELDS).safeParse(Object.fromEntries(formData));
    if (!id.success || !parsed.success) return { status: "error", key: "jobOrders.errors.invalid" };
    const values = parsed.data as Values;
    try {
      await tenantQuery(async (tx) => {
        const [before] = await tx.select().from(jobOrders).where(eq(jobOrders.id, id.data));
        if (!before) throw new ActionError("jobOrders.errors.notFound");
        await assertSkillFieldUsable(tx, values.fieldId, before.fieldId);
        const done = await tx.update(jobOrders).set(values).where(eq(jobOrders.id, id.data)).returning({ id: jobOrders.id });
        if (done.length !== 1) throw new ActionError("clients.errors.forbidden");
        const changed = changedFields(JOB_ORDER_FIELDS, before as Record<string, unknown>, values);
        if (changed.length) await auditTsk(tx, me, "job_order.update", "job_order", id.data, changed);
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_CHECK_VIOLATION && /bidang job order/.test(dbMessage(err))) return { status: "error", key: "jobOrders.errors.fieldNotAccepted" };
      throw err;
    }
    revalidatePath("/job-orders", "layout");
    return { status: "success", key: "jobOrders.saved" };
  });
}

/** Ubah status manual: tutup (CLOSED), buka lagi (OPEN), atau tandai terisi (FILLED). OPEN -> FILLED otomatis oleh database. */
export async function setJobOrderStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const id = uuid.safeParse(formData.get("jobOrderId"));
    const status = formData.get("status");
    if (!id.success || !(jobOrderStatus.enumValues as readonly string[]).includes(String(status))) return { status: "error", key: "jobOrders.errors.invalid" };
    await tenantQuery(async (tx) => {
      const done = await tx.update(jobOrders).set({ status: status as (typeof jobOrderStatus.enumValues)[number] }).where(eq(jobOrders.id, id.data)).returning({ id: jobOrders.id });
      if (done.length !== 1) throw new ActionError("jobOrders.errors.notFound");
      await auditTsk(tx, me, "job_order.status", "job_order", id.data, ["status"]);
    });
    revalidatePath("/job-orders", "layout");
    return { status: "success", key: "jobOrders.statusSaved" };
  });
}

/** Hapus job order: hanya TSK_ADMIN dan hanya yang belum dirujuk seleksi/penempatan (FK RESTRICT). */
export async function deleteJobOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  let deleted = false;
  const res = await guarded(async () => {
    const me = await requireTskAction();
    requireAdminAction(me);
    const id = uuid.safeParse(formData.get("jobOrderId"));
    if (!id.success) return { status: "error", key: "jobOrders.errors.invalid" };
    try {
      await tenantQuery(async (tx) => {
        const done = await tx.delete(jobOrders).where(eq(jobOrders.id, id.data)).returning({ id: jobOrders.id });
        if (done.length !== 1) throw new ActionError("jobOrders.errors.notFound");
        await auditTsk(tx, me, "job_order.delete", "job_order", id.data);
      });
    } catch (err) {
      if (pgErrorCode(err) === FK_VIOLATION) return { status: "error", key: "jobOrders.errors.inUse" };
      throw err;
    }
    deleted = true;
    return { status: "success", key: "jobOrders.deleted" };
  });
  if (deleted) {
    revalidatePath("/job-orders", "layout");
    redirect("/job-orders?deleted=1");
  }
  return res;
}

// ---------------------------------------------------------------------------------------------- Ajukan kandidat

/**
 * "Ajukan" dari tab Kandidat cocok: membuat atau memperbarui seleksi kandidat untuk job order ini menjadi SUBMITTED_TO_CLIENT.
 * Yang sudah lebih maju (mis. lulus interview client) tidak diturunkan. Hanya job order OPEN; kandidat yang sudah punya penempatan
 * aktif tidak bisa diajukan lagi (satu penempatan aktif per kandidat).
 */
export async function proposeCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const jobOrderId = uuid.safeParse(formData.get("jobOrderId"));
    const candidateId = uuid.safeParse(formData.get("candidateId"));
    if (!jobOrderId.success || !candidateId.success) return { status: "error", key: "jobOrders.errors.invalid" };
    await tenantQuery(async (tx) => {
      const [jo] = await tx.select({ status: jobOrders.status }).from(jobOrders).where(eq(jobOrders.id, jobOrderId.data));
      if (!jo) throw new ActionError("jobOrders.errors.notFound");
      if (jo.status !== "OPEN") throw new ActionError("jobOrders.errors.notOpen");
      const cand = await getCandidateForAction(tx, me, candidateId.data);
      if (!cand) throw new ActionError("detail.errors.notFound");
      if (cand.stage === "WITHDRAWN") throw new ActionError("jobOrders.errors.withdrawn");
      const [active] = await tx.select({ id: placements.id }).from(placements).where(and(eq(placements.candidateId, cand.id), eq(placements.status, "ACTIVE")));
      if (active) throw new ActionError("detail.errors.alreadyPlaced");
      const [row] = await tx
        .select({ decision: candidateSelections.decision })
        .from(candidateSelections)
        .where(and(eq(candidateSelections.candidateId, cand.id), eq(candidateSelections.tskOrgId, me.organizationId), eq(candidateSelections.jobOrderId, jobOrderId.data)));
      const ADVANCED = ["SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"]; // eksplisit
      if (row && ADVANCED.includes(row.decision)) return; // sudah diajukan atau lebih maju
      await upsertSelection(tx, me, cand, "SUBMITTED_TO_CLIENT", jobOrderId.data);
    });
    revalidatePath(`/job-orders/${jobOrderId.data}`);
    revalidatePath(`/candidates/${candidateId.data}`);
    revalidatePath("/candidates");
    return { status: "success", key: "jobOrders.proposedMsg" };
  });
}

// ---------------------------------------------------------------------------------------------- Penempatan

/** Ubah tanggal mulai (就労開始日), tanggal selesai, status, dan catatan penempatan. Kandidat/lokasi/job order tidak bisa diganti (trigger). */
export async function updatePlacement(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const id = uuid.safeParse(formData.get("placementId"));
    const parsed = buildSchema(PLACEMENT_FIELDS, [["startDate", "endDate"]]).safeParse(Object.fromEntries(formData));
    if (!id.success || !parsed.success) return { status: "error", key: "jobOrders.errors.placementInvalid" };
    const values = parsed.data as Values;
    if (values.status === "ENDED" && !values.endDate) return { status: "error", key: "jobOrders.errors.endDateRequired" };
    try {
      await tenantQuery(async (tx) => {
        const [before] = await tx.select().from(placements).where(eq(placements.id, id.data));
        if (!before) throw new ActionError("jobOrders.errors.notFound");
        const done = await tx.update(placements).set(values).where(eq(placements.id, id.data)).returning({ id: placements.id });
        if (done.length !== 1) throw new ActionError("clients.errors.forbidden");
        const changed = changedFields(PLACEMENT_FIELDS, before as Record<string, unknown>, values);
        if (changed.length) await auditTsk(tx, me, "placement.update", "placement", id.data, changed, before.candidateId);
      });
    } catch (err) {
      if (pgErrorCode(err) === "23505") return { status: "error", key: "detail.errors.alreadyPlaced" }; // dua penempatan ACTIVE
      throw err;
    }
    revalidatePath(`/candidates/${formData.get("candidateId")}`);
    return { status: "success", key: "jobOrders.saved" };
  });
}
