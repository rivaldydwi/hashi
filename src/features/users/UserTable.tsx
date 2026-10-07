import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { cardClass, tableHeadClass } from "@/components/styles";
import { LanguageChips } from "./LanguageChips";
import type { UserRow } from "./queries";

export async function UserTable({
  rows,
  basePath,
  currentUserId,
}: {
  rows: UserRow[];
  basePath: string;
  currentUserId: string;
}) {
  const t = await getTranslations();
  const format = await getFormatter();

  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="user-table">
          <thead className={tableHeadClass}>
            <tr>
              <th className="px-5 py-2 font-medium">{t("users.colName")}</th>
              <th className="px-5 py-2 font-medium">{t("users.colRole")}</th>
              <th className="px-5 py-2 font-medium">{t("users.colLanguage")}</th>
              <th className="px-5 py-2 font-medium">{t("users.colStatus")}</th>
              <th className="px-5 py-2 font-medium">{t("users.colLastLogin")}</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((u) => (
              <tr key={u.id} className={u.active ? "" : "bg-stone-50 text-stone-500"}>
                <td className="cjk-phrase min-w-40 px-5 py-3">
                  <div className="font-medium">
                    {u.name}
                    {u.id === currentUserId && (
                      <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600">
                        {t("users.you")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-stone-500">{u.email}</div>
                </td>
                <td className="px-5 py-3 whitespace-nowrap">{t(`roles.${u.role}`)}</td>
                <td className="px-5 py-3 whitespace-nowrap"><LanguageChips languages={u.languages} /></td>
                <td className="px-5 py-3">
                  {!u.active ? (
                    <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-700">
                      {t("users.inactive")}
                    </span>
                  ) : u.mustChangePassword ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      {t("users.mustChange")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                      {t("users.active")}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  {u.lastLoginAt
                    ? format.dateTime(u.lastLoginAt, { dateStyle: "medium", timeStyle: "short" })
                    : t("users.never")}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`${basePath}/${basePath.startsWith("/admin") ? "users/" : ""}${u.id}`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    {t("users.edit")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
