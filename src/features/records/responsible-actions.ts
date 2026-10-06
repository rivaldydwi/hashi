"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { clientCompanies, placements, responsibleAssignments } from "@/db/schema";
import { currentAssignment } from "@/db/responsibility";
import { listResponsibleStaff, loadAssignments } from "@/db/responsibility-queries";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery, type CurrentUser } from "@/lib/session";
import { requireStaffAction } from "./access";
import { str, uuid, ymd } from "./form";

/**
 * Tetapkan penanggung jawab (担当/責任者) per PERUSAHAAN klien (bawaan semua pekerjanya) atau per PENEMPATAN (menimpa perusahaan). `staffId` kosong = dikosongkan
 * (perusahaan: tanpa penanggung jawab; penempatan: kembali mengikuti perusahaan). Riwayat append-only dengan tanggal mulai berlaku. Hanya TSK_ADMIN; RLS dan trigger tetap penjaga akhir.
 * Audit: HANYA id baris dan jenis cakupan (tanpa nama staf/pekerja/perusahaan).
 */
export async function setResponsible(_prev: FormState, fd: FormData): Promise<FormState> {
  const me: CurrentUser = await requireStaffAction();
  try {
    if (me.role !== "TSK_ADMIN") throw new ActionError("records.errors.forbidden");
    const scope = str(fd, "scope");
    const targetId = str(fd, "targetId");
    const staffRaw = str(fd, "staffId");
    if ((scope !== "company" && scope !== "placement") || !uuid.safeParse(targetId).success || (staffRaw && !uuid.safeParse(staffRaw).success)) throw new ActionError("records.errors.invalid");
    const today = ymdIn(new Date(), safeTimezone(me.organizationTimezone, me.organizationType));
    const fromRaw = str(fd, "effectiveFrom") || today;
    const from = ymd.safeParse(fromRaw);
    if (!from.success || from.data < "2020-01-01" || from.data > `${Number(today.slice(0, 4)) + 1}-12-31`) throw new ActionError("responsible.errors.dateInvalid");

    await tenantQuery(async (tx) => {
      if (scope === "company") {
        if (!(await tx.select({ id: clientCompanies.id }).from(clientCompanies).where(eq(clientCompanies.id, targetId)).limit(1)).length) throw new ActionError("responsible.errors.targetNotFound");
      } else {
        const [p] = await tx.select({ id: placements.id, status: placements.status }).from(placements).where(eq(placements.id, targetId)).limit(1);
        if (!p) throw new ActionError("responsible.errors.targetNotFound");
      }
      if (staffRaw && !(await listResponsibleStaff(tx)).some((s) => s.id === staffRaw)) throw new ActionError("responsible.errors.staffInvalid");
      // tanpa perubahan (sama dengan yang berlaku sekarang dan tanggalnya tidak mundur ke masa depan): tidak menambah baris riwayat
      const { byCompany, byPlacement } = await loadAssignments(tx);
      const cur = currentAssignment((scope === "company" ? byCompany : byPlacement).get(targetId) ?? [], today);
      if (from.data <= today && (cur?.staffId ?? null) === (staffRaw || null) && (cur !== null || staffRaw === "")) throw new ActionError("responsible.errors.noChange");
      const [row] = await tx
        .insert(responsibleAssignments)
        .values({ organizationId: me.organizationId, createdBy: me.id, companyId: scope === "company" ? targetId : null, placementId: scope === "placement" ? targetId : null, staffId: staffRaw || null, effectiveFrom: from.data })
        .returning({ id: responsibleAssignments.id });
      await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: "responsible.set", entity: "responsible_assignment", entityId: row.id, after: { scope } });
    });
    revalidatePath("/records/responsible");
    return { status: "success", key: "responsible.saved" };
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    const code = pgErrorCode(err);
    if (code === "23514") return { status: "error", key: "records.errors.invalid" };
    if (code === "42501") return { status: "error", key: "records.errors.notAllowed" };
    throw err;
  }
}
