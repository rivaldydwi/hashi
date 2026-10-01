import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { cardClass } from "@/components/styles";
import { LanguageChips } from "@/features/users/LanguageChips";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const me = await requireUser();
  const t = await getTranslations();

  const rows: Array<[string, ReactNode]> = [
    [t("users.fieldName"), me.name],
    [t("users.fieldEmail"), me.email],
    [t("users.fieldRole"), t(`roles.${me.role}`)],
    [t("account.organization"), me.organizationName],
    [t("users.colLanguage"), <LanguageChips key="languages" languages={me.languages} />],
  ];

  return (
    <>
      <PageHeader title={t("account.title")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={`${cardClass} p-6`}>
          <h2 className="mb-4 font-medium">{t("account.profile")}</h2>
          <dl className="space-y-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-3 gap-2">
                <dt className="text-stone-500">{label}</dt>
                <dd className="col-span-2 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={`${cardClass} p-6`}>
          <h2 className="mb-4 font-medium">{t("account.changePassword")}</h2>
          <ChangePasswordForm />
        </section>
      </div>
    </>
  );
}
