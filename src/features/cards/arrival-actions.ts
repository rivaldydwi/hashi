"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { placements } from "@/db/schema";
import { validYmd } from "./input";
import { str, uuid } from "@/features/records/form";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery } from "@/lib/session";
import { runCard } from "./guards";
import { cardEditAccess } from "./queries";

// Tanggal tiba pekerja di Jepang (T-024). Tulis = TSK_ADMIN atau 担当 efektif (trigger `placements_guard` dan pemeriksaan di sini sama); tidak boleh di masa depan (tanggal Tokyo/organisasi);
// kosong = menghapus. Audit `placement.arrival_update`: NAMA kolom saja. LPK_ADMIN pemilik melihatnya hanya lewat fungsi sempit `lpk_worker_status`.

const runForm = (fn: Parameters<typeof runCard<FormState>>[0]) => runCard<FormState>(fn, (key) => ({ status: "error", key }));

export async function saveArrival(_prev: FormState, fd: FormData): Promise<FormState> {
  return runForm(async (me, today) => {
    const candidateId = str(fd, "candidateId");
    if (!uuid.safeParse(candidateId).success) throw new ActionError("cards.errors.invalid");
    const raw = str(fd, "arrivedOn").trim();
    if (raw && !validYmd(raw)) throw new ActionError("cards.errors.dateInvalid");
    if (raw && raw > today) throw new ActionError("cards.arrival.errors.future");
    await tenantQuery(async (tx) => {
      const access = await cardEditAccess(tx, me, candidateId, today);
      if (!access.activeWorker) throw new ActionError("cards.errors.workerNotActive");
      if (!access.canEdit) throw new ActionError("cards.errors.notEditor");
      const [before] = await tx.select({ arrivedOn: placements.arrivedOn }).from(placements).where(and(eq(placements.candidateId, candidateId), eq(placements.status, "ACTIVE"))).limit(1);
      if (!before) throw new ActionError("cards.errors.workerNotActive");
      if ((before.arrivedOn ?? "") === raw) throw new ActionError("cards.errors.noChange");
      await tx.update(placements).set({ arrivedOn: raw || null }).where(and(eq(placements.candidateId, candidateId), eq(placements.status, "ACTIVE")));
      await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: "placement.arrival_update", entity: "placement", entityId: candidateId, after: { fields: ["arrivedOn"] } });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    revalidatePath(`/candidates/${candidateId}`);
    return { status: "success", key: "cards.arrival.saved" };
  });
}
