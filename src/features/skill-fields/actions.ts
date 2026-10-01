"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/db";
import { skillFields } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode, PG_UNIQUE_VIOLATION } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { requireRole } from "@/lib/session";

const FK_VIOLATION = "23503";

const nameSchema = z.string().trim().min(1).max(120);
const createSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  nameId: nameSchema,
  nameJa: nameSchema,
  sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
});
const updateSchema = z.object({ id: z.uuid(), nameId: nameSchema, nameJa: nameSchema, sortOrder: z.coerce.number().int().min(0).max(100000) });

function revalidate() {
  revalidatePath("/admin/skill-fields");
  revalidatePath("/", "layout"); // pilihan bidang ada di layout (form, filter)
}

/** Tambah bidang kerja. Hanya super admin. Kode bersifat tetap (tidak bisa diubah setelah dibuat). */
export async function createSkillField(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  try {
    await withSystem(async (tx) => {
      const [row] = await tx.insert(skillFields).values(parsed.data).returning({ id: skillFields.id });
      await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: "skill_field.create", entity: "skill_field", entityId: row.id, after: { code: parsed.data.code } });
    });
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) return { status: "error", key: "skillFields.errors.codeTaken" };
    throw err;
  }
  revalidate();
  return { status: "success", key: "skillFields.created" };
}

/** Ubah nama dan urutan (kode tetap). */
export async function updateSkillField(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const { id, ...values } = parsed.data;
  await withSystem(async (tx) => {
    const done = await tx.update(skillFields).set(values).where(eq(skillFields.id, id)).returning({ id: skillFields.id });
    if (done.length !== 1) throw new ActionError("skillFields.errors.notFound");
    await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: "skill_field.update", entity: "skill_field", entityId: id, after: { fields: ["nameId", "nameJa", "sortOrder"] } });
  });
  revalidate();
  return { status: "success", key: "skillFields.saved" };
}

/** Aktifkan / nonaktifkan (bidang nonaktif tidak muncul di pilihan baru; data lama tetap). */
export async function setSkillFieldActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", key: "common.invalidInput" };
  const active = formData.get("active") === "true";
  await withSystem(async (tx) => {
    const done = await tx.update(skillFields).set({ active }).where(eq(skillFields.id, id.data)).returning({ id: skillFields.id });
    if (done.length !== 1) throw new ActionError("skillFields.errors.notFound");
    await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: active ? "skill_field.activate" : "skill_field.deactivate", entity: "skill_field", entityId: id.data });
  });
  revalidate();
  return { status: "success", key: active ? "skillFields.activated" : "skillFields.deactivated" };
}

/** Hapus bidang yang BELUM dipakai (FK RESTRICT dari kandidat, klien, dan job order menolak yang sudah dipakai). */
export async function deleteSkillField(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", key: "common.invalidInput" };
  try {
    await withSystem(async (tx) => {
      const done = await tx.delete(skillFields).where(eq(skillFields.id, id.data)).returning({ id: skillFields.id });
      if (done.length !== 1) throw new ActionError("skillFields.errors.notFound");
      await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: "skill_field.delete", entity: "skill_field", entityId: id.data });
    });
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    if (pgErrorCode(err) === FK_VIOLATION) return { status: "error", key: "skillFields.errors.inUse" };
    throw err;
  }
  revalidate();
  return { status: "success", key: "skillFields.deleted" };
}
