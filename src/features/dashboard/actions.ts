"use server";

import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { userDashboardLayouts } from "@/db/schema";
import { LayoutError, parseLayoutInput } from "@/db/dashboard-layout";
import { requireUser } from "@/lib/session";

// Preferensi tampilan milik sendiri: SENGAJA tidak diaudit (bukan data kandidat/organisasi). RLS: hanya baris user sendiri.
// Dipanggil klien (mode atur) dengan simpan otomatis; mengembalikan { ok } alih-alih melempar supaya UI bisa menampilkan status.

export async function saveDashboardLayout(input: unknown): Promise<{ ok: boolean }> {
  const user = await requireUser();
  let layout;
  try {
    layout = parseLayoutInput(user.role, input);
  } catch (err) {
    if (err instanceof LayoutError) return { ok: false };
    throw err;
  }
  await withTenant({ orgId: user.organizationId, role: user.role, userId: user.id }, (tx) =>
    tx
      .insert(userDashboardLayouts)
      .values({ userId: user.id, orgId: user.organizationId, layout })
      .onConflictDoUpdate({ target: userDashboardLayouts.userId, set: { layout, updatedAt: new Date() } }),
  );
  return { ok: true };
}

/** Kembalikan ke bawaan = hapus baris (susunan bawaan peran dipakai lagi, termasuk widget baru dari katalog). */
export async function resetDashboardLayout(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await withTenant({ orgId: user.organizationId, role: user.role, userId: user.id }, (tx) =>
    tx.delete(userDashboardLayouts).where(eq(userDashboardLayouts.userId, user.id)),
  );
  return { ok: true };
}
