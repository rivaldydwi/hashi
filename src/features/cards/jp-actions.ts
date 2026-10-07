"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { workerJpProfiles } from "@/db/schema";
import { str, uuid } from "@/features/records/form";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery } from "@/lib/session";
import { runCard } from "./guards";
import { cardEditAccess } from "./queries";

// Data pekerja di Jepang (alamat tinggal + telepon/HP; T-021). Tulis = TSK_ADMIN atau 担当 efektif (RLS `card_editor` tetap penjaga akhir). Audit `worker_jp_profile.update`: NAMA kolom saja.

const PHONE = /^[0-9+\-() ]{6,40}$/;
const runForm = (fn: Parameters<typeof runCard<FormState>>[0]) => runCard<FormState>(fn, (key) => ({ status: "error", key }));

export async function saveJpProfile(_prev: FormState, fd: FormData): Promise<FormState> {
  return runForm(async (me, today) => {
    const candidateId = str(fd, "candidateId");
    if (!uuid.safeParse(candidateId).success) throw new ActionError("cards.errors.invalid");
    const address = str(fd, "addressJp").trim();
    const phone = str(fd, "phoneJp").trim();
    if (address.length > 300) throw new ActionError("cards.jp.errors.addressTooLong");
    if (phone && !PHONE.test(phone)) throw new ActionError("cards.jp.errors.phoneInvalid");
    await tenantQuery(async (tx) => {
      const access = await cardEditAccess(tx, me, candidateId, today);
      if (!access.activeWorker) throw new ActionError("cards.errors.workerNotActive");
      if (!access.canEdit) throw new ActionError("cards.errors.notEditor");
      const [before] = await tx.select({ addressJp: workerJpProfiles.addressJp, phoneJp: workerJpProfiles.phoneJp }).from(workerJpProfiles).where(eq(workerJpProfiles.candidateId, candidateId)).limit(1);
      const next = { addressJp: address || null, phoneJp: phone || null };
      const fields = (["addressJp", "phoneJp"] as const).filter((k) => (before?.[k] ?? null) !== next[k]);
      if (fields.length === 0) throw new ActionError("cards.errors.noChange");
      await tx.insert(workerJpProfiles).values({ organizationId: me.organizationId, candidateId, createdBy: me.id, ...next }).onConflictDoUpdate({ target: workerJpProfiles.candidateId, set: next });
      await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: "worker_jp_profile.update", entity: "worker_jp_profile", entityId: candidateId, after: { fields: fields.sort() } });
    });
    revalidatePath(`/records/workers/${candidateId}`);
    revalidatePath(`/records/workers/${candidateId}/renewal`);
    return { status: "success", key: "cards.jp.saved" };
  });
}
