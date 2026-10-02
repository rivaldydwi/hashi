"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/db";
import { locale as localeEnum, organizations, partnerships, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError, PG_CHECK_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { generateTempPassword, hashPassword } from "@/lib/passwords";
import { ADMIN_ROLE_BY_ORG_TYPE } from "@/lib/permissions";
import { ORG_TIMEZONES } from "@/lib/org-time";
import { requireRole } from "@/lib/session";

const orgFields = {
  name: z.string().trim().min(1).max(160),
  country: z.enum(["ID", "JP"]),
  defaultLocale: z.enum(localeEnum.enumValues),
};

const createOrgSchema = z.object({
  ...orgFields,
  type: z.enum(["LPK", "TSK"]),
  adminName: z.string().trim().min(1).max(120),
  adminEmail: z.email().max(254).transform((v) => v.trim().toLowerCase()),
});

const updateOrgSchema = z.object({ ...orgFields, id: z.uuid(), timezone: z.enum(ORG_TIMEZONES) });

/** Buat organisasi baru sekaligus admin pertamanya (dengan kata sandi sementara). */
export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const parsed = createOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const input = parsed.data;

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const orgId = await withSystem(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: input.name, type: input.type, country: input.country, defaultLocale: input.defaultLocale })
        .returning({ id: organizations.id });

      const [admin] = await tx
        .insert(users)
        .values({
          organizationId: org.id,
          name: input.adminName,
          email: input.adminEmail,
          role: ADMIN_ROLE_BY_ORG_TYPE[input.type],
          locale: input.defaultLocale,
          languages: [input.defaultLocale], // bahasa yang dikuasai admin pertama; bisa diubah di form pengguna
          passwordHash,
          mustChangePassword: true,
        })
        .returning({ id: users.id });

      await audit(tx, {
        organizationId: org.id,
        actorUserId: me.id,
        action: "organization.create",
        entity: "organization",
        entityId: org.id,
        after: { name: input.name, type: input.type, country: input.country, defaultLocale: input.defaultLocale },
      });
      await audit(tx, {
        organizationId: org.id,
        actorUserId: me.id,
        action: "user.create",
        entity: "user",
        entityId: admin.id,
        after: { name: input.adminName, email: input.adminEmail, role: ADMIN_ROLE_BY_ORG_TYPE[input.type] },
      });
      return org.id;
    });

    revalidatePath("/admin/organizations");
    revalidatePath("/");
    return { status: "success", key: "orgs.created", tempPassword, email: input.adminEmail, id: orgId };
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) return { status: "error", key: "users.errors.emailTaken" };
    throw err;
  }
}

/** Ubah nama, negara, dan bahasa default organisasi. Jenis organisasi tidak bisa diubah. */
export async function updateOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const parsed = updateOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const input = parsed.data;

  try {
    await withSystem(async (tx) => {
      const [before] = await tx.select().from(organizations).where(eq(organizations.id, input.id)).limit(1);
      if (!before) throw new ActionError("common.notFound");
      await tx
        .update(organizations)
        .set({ name: input.name, country: input.country, defaultLocale: input.defaultLocale, timezone: input.timezone })
        .where(eq(organizations.id, input.id));
      await audit(tx, {
        organizationId: input.id,
        actorUserId: me.id,
        action: "organization.update",
        entity: "organization",
        entityId: input.id,
        before: { name: before.name, country: before.country, defaultLocale: before.defaultLocale, timezone: before.timezone },
        after: { name: input.name, country: input.country, defaultLocale: input.defaultLocale, timezone: input.timezone },
      });
    });
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    throw err;
  }

  revalidatePath("/", "layout");
  return { status: "success", key: "orgs.saved" };
}

const partnershipSchema = z.object({ lpkId: z.uuid(), tskId: z.uuid() });

/** Hubungkan satu LPK dengan satu TSK. */
export async function createPartnership(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const parsed = partnershipSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const { lpkId, tskId } = parsed.data;

  try {
    await withSystem(async (tx) => {
      const [row] = await tx.insert(partnerships).values({ lpkId, tskId }).returning({ id: partnerships.id });
      for (const orgId of [lpkId, tskId]) {
        await audit(tx, {
          organizationId: orgId,
          actorUserId: me.id,
          action: "partnership.create",
          entity: "partnership",
          entityId: row.id,
          after: { lpkId, tskId, active: true },
        });
      }
    });
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === PG_UNIQUE_VIOLATION) return { status: "error", key: "partnerships.errors.exists" };
    if (code === PG_CHECK_VIOLATION) return { status: "error", key: "partnerships.errors.invalidPair" };
    throw err;
  }

  revalidatePath("/", "layout");
  return { status: "success", key: "partnerships.created" };
}

/** Aktifkan / nonaktifkan kemitraan (TSK langsung kehilangan/mendapat akses ke kandidat LPK). */
export async function setPartnershipActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireRole("SUPER_ADMIN");
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", key: "common.invalidInput" };
  const active = parsed.data.active === "true";

  const found = await withSystem(async (tx) => {
    const [row] = await tx
      .update(partnerships)
      .set({ active })
      .where(eq(partnerships.id, parsed.data.id))
      .returning({ id: partnerships.id, lpkId: partnerships.lpkId, tskId: partnerships.tskId });
    if (!row) return false;
    for (const orgId of [row.lpkId, row.tskId]) {
      await audit(tx, {
        organizationId: orgId,
        actorUserId: me.id,
        action: active ? "partnership.activate" : "partnership.deactivate",
        entity: "partnership",
        entityId: row.id,
        after: { active },
      });
    }
    return true;
  });
  if (!found) return { status: "error", key: "common.notFound" };

  revalidatePath("/", "layout");
  return { status: "success", key: "partnerships.updated" };
}
