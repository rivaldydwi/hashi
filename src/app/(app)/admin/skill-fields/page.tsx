import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";
import { cardClass, tableHeadClass } from "@/components/styles";
import { withSystem } from "@/db";
import { listSkillFields } from "@/db/skill-fields";
import { SkillFieldCreateForm, SkillFieldRowForms } from "@/features/skill-fields/SkillFieldForms";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Skill fields" };
export const dynamic = "force-dynamic";

/** Master bidang kerja (hanya super admin): tambah, ubah nama, nonaktifkan; yang sudah dipakai tidak bisa dihapus. */
export default async function SkillFieldsPage() {
  await requireRole("SUPER_ADMIN");
  const t = await getTranslations("skillFields");
  const { rows, usage } = await withSystem(async (tx) => ({
    rows: await listSkillFields(tx),
    // Jumlah pemakaian per bidang (kandidat; klien dan job order ditambahkan di bagian berikutnya); hanya angka
    usage: new Map(
      (
        (await tx.execute(sql`
          select f.id::text as id,
            (select count(*) from candidates c where c.field_id = f.id)::int as n
          from skill_fields f`)).rows as Array<{ id: string; n: number }>
      ).map((r) => [r.id, r.n]),
    ),
  }));

  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <SkillFieldCreateForm />
      <div className={`${cardClass} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="skill-field-table">
            <thead className={tableHeadClass}>
              <tr>
                <th className="px-5 py-2 font-medium">{t("code")}</th>
                <th className="px-5 py-2 font-medium">{t("names")}</th>
                <th className="px-5 py-2 font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "bg-stone-50 text-stone-500"} data-testid="skill-field-row" data-code={r.code}>
                  <td className="px-5 py-3 align-top font-mono text-xs">{r.code}</td>
                  <td className="px-5 py-3">
                    <SkillFieldRowForms id={r.id} nameId={r.nameId} nameJa={r.nameJa} sortOrder={r.sortOrder} active={r.active} used={usage.get(r.id) ?? 0} />
                  </td>
                  <td className="px-5 py-3 align-top">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.active ? "bg-emerald-50 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>{r.active ? t("active") : t("inactive")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
