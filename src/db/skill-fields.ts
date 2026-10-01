// Bidang kerja (tabel master skill_fields): query dan label. Di src/db supaya script (seed, verify:seed) memakai kode yang sama.
import { asc } from "drizzle-orm";
import type { Tx } from "./index";
import { skillFields } from "./schema";

export type SkillField = { id: string; code: string; nameId: string; nameJa: string; active: boolean; sortOrder: number };

/** Semua bidang (aktif dan nonaktif), urut menurut sort_order lalu nama. Pemanggil menyaring `active` sesuai kebutuhan. */
export async function listSkillFields(tx: Tx): Promise<SkillField[]> {
  return tx
    .select({ id: skillFields.id, code: skillFields.code, nameId: skillFields.nameId, nameJa: skillFields.nameJa, active: skillFields.active, sortOrder: skillFields.sortOrder })
    .from(skillFields)
    .orderBy(asc(skillFields.sortOrder), asc(skillFields.nameId));
}

/** Nama bidang menurut bahasa tampilan (id / ja). */
export function skillFieldName(f: { nameId: string; nameJa: string }, locale: string): string {
  return locale === "ja" ? f.nameJa : f.nameId;
}
