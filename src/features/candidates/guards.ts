import { z } from "zod";
import type { Tx } from "@/db";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { requireUser, type CurrentUser } from "@/lib/session";
import { getCandidateForAction } from "./detail-queries";
import { contentAccess } from "./permissions";

export const uuid = z.uuid();
export const ok = (key = "detail.saved"): FormState => ({ status: "success", key });

export async function run(fn: (me: CurrentUser) => Promise<FormState>): Promise<FormState> {
  const me = await requireUser();
  try {
    return await fn(me);
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    throw err;
  }
}

/** Catat perubahan di log LPK PEMILIK kandidat. Hanya NAMA kolom yang berubah, tidak pernah isinya. */
export async function auditChange(
  tx: Tx,
  me: CurrentUser,
  cand: { id: string; organizationId: string },
  action: string,
  entity: string,
  entityId: string,
  section: string,
  fields?: string[],
) {
  await audit(tx, {
    organizationId: cand.organizationId,
    actorOrgId: me.organizationId,
    candidateId: cand.id,
    actorUserId: me.id,
    action,
    entity,
    entityId,
    after: fields ? { section, fields } : { section },
  });
}

/** Kandidat terlihat + pemanggil boleh mengedit isinya (LPK_ADMIN, atau TSK dengan keputusan yang membuka hak edit). */
export async function requireEditable(tx: Tx, me: CurrentUser, candidateId: unknown) {
  if (!uuid.safeParse(candidateId).success) throw new ActionError("common.invalidInput");
  const cand = await getCandidateForAction(tx, me, candidateId as string);
  if (!cand) throw new ActionError("detail.errors.notFound");
  const access = contentAccess(me.role, cand.stage, cand.myDecision);
  if (!access.canEdit) throw new ActionError("detail.errors.readOnly");
  return { cand, access };
}
