import { cache } from "react";
import { getLocale } from "next-intl/server";
import { listSkillFields, skillFieldName, type SkillField } from "@/db/skill-fields";
import { tenantQuery } from "@/lib/session";

/** Semua bidang kerja (sekali per request). Dibaca lewat RLS: semua peran yang login boleh membaca. */
export const getSkillFields = cache(async (): Promise<SkillField[]> => tenantQuery((tx) => listSkillFields(tx)));

/** Pilihan untuk form/filter: label sudah mengikuti bahasa tampilan. `active=false` hanya ditampilkan bila nilai saat ini memakainya. */
export async function getSkillFieldOptions() {
  const [fields, locale] = await Promise.all([getSkillFields(), getLocale()]);
  return fields.map((f) => ({ id: f.id, code: f.code, label: skillFieldName(f, locale), active: f.active }));
}
export type SkillFieldOption = Awaited<ReturnType<typeof getSkillFieldOptions>>[number];
