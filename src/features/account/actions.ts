"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "@/lib/passwords";
import { requireUser } from "@/lib/session";

function field(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Ganti kata sandi sendiri. Juga dipakai untuk ganti wajib setelah kata sandi sementara. */
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireUser();
  const current = field(formData, "currentPassword");
  const next = field(formData, "newPassword");
  const confirm = field(formData, "confirmPassword");

  if (next.length < PASSWORD_MIN_LENGTH || next.length > PASSWORD_MAX_LENGTH) {
    return { status: "error", key: "account.errors.tooShort" };
  }
  if (next !== confirm) return { status: "error", key: "account.errors.mismatch" };
  if (next === current) return { status: "error", key: "account.errors.sameAsOld" };

  const [row] = await withTenant({ orgId: me.organizationId, role: me.role, userId: me.id }, (tx) =>
    tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1),
  );
  if (!row || !(await verifyPassword(current, row.hash))) {
    return { status: "error", key: "account.errors.wrongCurrent" };
  }

  const passwordHash = await hashPassword(next);
  await withTenant({ orgId: me.organizationId, role: me.role, userId: me.id }, async (tx) => {
    await tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, me.id));
    await audit(tx, {
      organizationId: me.organizationId,
      actorUserId: me.id,
      action: "user.password_change",
      entity: "user",
      entityId: me.id,
    });
  });

  if (me.mustChangePassword) redirect("/");
  return { status: "success", key: "account.changed" };
}
