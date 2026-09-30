"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { candidates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { requireRole, tenantQuery } from "@/lib/session";
import { addCandidateSchema, EARLIEST_BIRTH_DATE, latestAllowedDate } from "./validation";

/** Tambah kandidat baru. HANYA LPK_ADMIN; organisasinya selalu organisasi user, bukan dari form. */
export async function addCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("LPK_ADMIN");
  const parsed = addCandidateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const input = parsed.data;

  const latest = latestAllowedDate();
  if (input.birthDate < EARLIEST_BIRTH_DATE || input.birthDate > latest) {
    return { status: "error", key: "candidates.errors.birthDateInvalid" };
  }
  if (input.dataConsentDate > latest) return { status: "error", key: "candidates.errors.consentInFuture" };

  try {
    await tenantQuery(async (tx) => {
      const [row] = await tx
        .insert(candidates)
        .values({
          organizationId: me.organizationId,
          fullName: input.fullName,
          gender: input.gender,
          birthDate: input.birthDate,
          field: input.field,
          dataConsentDate: input.dataConsentDate,
        })
        .returning({ id: candidates.id, stage: candidates.stage });

      await audit(tx, {
        organizationId: me.organizationId,
        actorUserId: me.id,
        candidateId: row.id,
        action: "candidate.create",
        entity: "candidate",
        entityId: row.id,
        after: {
          fullName: input.fullName,
          gender: input.gender,
          birthDate: input.birthDate,
          field: input.field,
          dataConsentDate: input.dataConsentDate,
          stage: row.stage,
        },
      });
    });
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    throw err;
  }

  revalidatePath("/candidates");
  redirect("/candidates?added=1");
}
