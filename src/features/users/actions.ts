"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users, role as roleEnum, language as languageEnum } from "@/db/schema";
import { initialLocale, normalizeLanguages } from "@/lib/languages";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode, PG_UNIQUE_VIOLATION } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { generateTempPassword, hashPassword } from "@/lib/passwords";
import { isAdminRole, roleAllowedFor } from "@/lib/permissions";
import { countOtherActiveAdmins, getOrganization, getUser } from "./queries";
import { isUuid, userAdminScope } from "./scope";

const nameSchema = z.string().trim().min(1).max(120);

const createSchema = z.object({
  name: nameSchema,
  email: z.email().max(254).transform((v) => v.trim().toLowerCase()),
  role: z.enum(roleEnum.enumValues),
});

const updateSchema = z.object({
  userId: z.uuid(),
  name: nameSchema,
  role: z.enum(roleEnum.enumValues),
});

const languagesSchema = z.array(z.enum(languageEnum.enumValues)).min(1);

/** Bahasa yang dikuasai dari kotak centang (`languages`, bisa banyak). Kosong / tidak dikenal = error dengan pesan khusus. */
function languagesFrom(formData: FormData) {
  const parsed = languagesSchema.safeParse(formData.getAll("languages"));
  return parsed.success ? normalizeLanguages(parsed.data) : null;
}

const sameLanguages = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function orgIdFrom(formData: FormData) {
  const v = formData.get("orgId");
  return typeof v === "string" && v ? v : null;
}

function toErrorState(err: unknown): FormState {
  if (err instanceof ActionError) return { status: "error", key: err.code };
  if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) return { status: "error", key: "users.errors.emailTaken" };
  throw err;
}

/** Tambah pengguna baru dengan kata sandi sementara. */
export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await userAdminScope(orgIdFrom(formData));
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const languages = languagesFrom(formData);
  if (!languages) return { status: "error", key: "users.errors.languagesRequired" };
  const input = parsed.data;

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const created = await scope.run(async (tx) => {
      const org = await getOrganization(tx, scope.orgId);
      if (!org) throw new ActionError("users.errors.notFound");
      if (!roleAllowedFor(org.type, input.role)) throw new ActionError("users.errors.roleNotAllowed");

      const [row] = await tx
        .insert(users)
        .values({
          organizationId: org.id,
          name: input.name,
          email: input.email,
          role: input.role,
          languages,
          locale: initialLocale(languages), // bahasa tampilan awal; selanjutnya diubah lewat tombol bahasa
          passwordHash,
          mustChangePassword: true,
        })
        .returning({ id: users.id });

      await audit(tx, {
        organizationId: org.id,
        actorUserId: scope.me.id,
        action: "user.create",
        entity: "user",
        entityId: row.id,
        after: { name: input.name, email: input.email, role: input.role, languages },
      });
      return row;
    });

    revalidatePath(scope.basePath);
    return { status: "success", key: "users.created", tempPassword, email: input.email, id: created.id };
  } catch (err) {
    return toErrorState(err);
  }
}

/** Ubah nama, peran, dan bahasa pengguna. */
export async function updateUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await userAdminScope(orgIdFrom(formData));
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const languages = languagesFrom(formData);
  if (!languages) return { status: "error", key: "users.errors.languagesRequired" };
  const input = parsed.data;

  try {
    await scope.run(async (tx) => {
      const org = await getOrganization(tx, scope.orgId);
      const target = await getUser(tx, scope.orgId, input.userId);
      if (!org || !target) throw new ActionError("users.errors.notFound");
      if (!roleAllowedFor(org.type, input.role)) throw new ActionError("users.errors.roleNotAllowed");

      if (input.role !== target.role) {
        if (target.id === scope.me.id) throw new ActionError("users.errors.selfRole");
        const losingAdmin = isAdminRole(target.role) && !isAdminRole(input.role) && target.active;
        if (losingAdmin && (await countOtherActiveAdmins(tx, org.id, target.id)) === 0) {
          throw new ActionError("users.errors.lastAdmin");
        }
      }

      await tx
        .update(users)
        .set({ name: input.name, role: input.role, languages }) // `locale` (bahasa tampilan) sengaja tidak disentuh
        .where(eq(users.id, target.id));

      await audit(tx, {
        organizationId: org.id,
        actorUserId: scope.me.id,
        action: "user.update",
        entity: "user",
        entityId: target.id,
        before: { name: target.name, role: target.role },
        // `languages` hanya dicatat NAMA kolomnya (bila berubah), seperti kolom lain yang tidak memuat isi
        after: { name: input.name, role: input.role, ...(sameLanguages(target.languages, languages) ? {} : { changed: ["languages"] }) },
      });
    });

    revalidatePath(scope.basePath, "layout");
    return { status: "success", key: "users.saved" };
  } catch (err) {
    return toErrorState(err);
  }
}

/** Buat kata sandi sementara baru dan keluarkan pengguna dari semua sesinya. */
export async function resetUserPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await userAdminScope(orgIdFrom(formData));
  const userId = formData.get("userId");
  if (!isUuid(userId)) return { status: "error", key: "common.invalidInput" };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const email = await scope.run(async (tx) => {
      const target = await getUser(tx, scope.orgId, userId);
      if (!target) throw new ActionError("users.errors.notFound");
      if (target.id === scope.me.id) throw new ActionError("users.errors.selfReset");

      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: true, sessionsRevokedAt: new Date() })
        .where(eq(users.id, target.id));

      await audit(tx, {
        organizationId: scope.orgId,
        actorUserId: scope.me.id,
        action: "user.password_reset",
        entity: "user",
        entityId: target.id,
      });
      return target.email;
    });

    revalidatePath(scope.basePath, "layout");
    return { status: "success", key: "users.passwordReset", tempPassword, email };
  } catch (err) {
    return toErrorState(err);
  }
}

/** Nonaktifkan atau aktifkan kembali pengguna. */
export async function setUserActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await userAdminScope(orgIdFrom(formData));
  const userId = formData.get("userId");
  const active = formData.get("active") === "true";
  if (!isUuid(userId)) return { status: "error", key: "common.invalidInput" };

  try {
    await scope.run(async (tx) => {
      const target = await getUser(tx, scope.orgId, userId);
      if (!target) throw new ActionError("users.errors.notFound");
      if (!active) {
        if (target.id === scope.me.id) throw new ActionError("users.errors.selfDeactivate");
        if (isAdminRole(target.role) && (await countOtherActiveAdmins(tx, scope.orgId, target.id)) === 0) {
          throw new ActionError("users.errors.lastAdmin");
        }
      }

      await tx.update(users).set({ active }).where(eq(users.id, target.id));
      await audit(tx, {
        organizationId: scope.orgId,
        actorUserId: scope.me.id,
        action: active ? "user.reactivate" : "user.deactivate",
        entity: "user",
        entityId: target.id,
        before: { active: target.active },
        after: { active },
      });
    });

    revalidatePath(scope.basePath, "layout");
    return { status: "success", key: active ? "users.reactivated" : "users.deactivated" };
  } catch (err) {
    return toErrorState(err);
  }
}
