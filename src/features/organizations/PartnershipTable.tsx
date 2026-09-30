import { getFormatter, getTranslations } from "next-intl/server";
import { cardClass, tableHeadClass } from "@/components/styles";
import { PartnershipToggle } from "./PartnershipToggle";

type Row = {
  id: string;
  active: boolean;
  createdAt: Date;
  lpkName: string;
  tskName: string;
};

export async function PartnershipTable({ rows, editable }: { rows: Row[]; editable: boolean }) {
  const t = await getTranslations("partnerships");
  const format = await getFormatter();

  if (rows.length === 0) {
    return <p className={`${cardClass} p-5 text-sm text-stone-500`}>{t("none")}</p>;
  }

  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="partnership-table">
          <thead className={tableHeadClass}>
            <tr>
              <th className="px-5 py-2 font-medium">{t("colTsk")}</th>
              <th className="px-5 py-2 font-medium">{t("colLpk")}</th>
              <th className="px-5 py-2 font-medium">{t("colStatus")}</th>
              <th className="px-5 py-2 font-medium">{t("colSince")}</th>
              {editable && <th className="px-5 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((p) => (
              <tr key={p.id} className={p.active ? "" : "text-stone-500"}>
                <td className="px-5 py-3 font-medium">{p.tskName}</td>
                <td className="px-5 py-3">{p.lpkName}</td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      p.active ? "bg-emerald-50 text-emerald-800" : "bg-stone-200 text-stone-700"
                    }`}
                  >
                    {p.active ? t("active") : t("inactive")}
                  </span>
                </td>
                <td className="px-5 py-3 whitespace-nowrap">{format.dateTime(p.createdAt, { dateStyle: "medium" })}</td>
                {editable && (
                  <td className="px-5 py-3 text-right">
                    <PartnershipToggle id={p.id} active={p.active} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
