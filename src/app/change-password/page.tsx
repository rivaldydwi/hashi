import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/BrandMark";
import { cardClass } from "@/components/styles";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";
import { logout } from "@/lib/actions";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Password" };

// Halaman wajib setelah login dengan kata sandi sementara.
export default async function ForcedChangePasswordPage() {
  const me = await requireUser();
  if (!me.mustChangePassword) redirect("/account");
  const t = await getTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("account.forcedTitle")}</h1>
          <p className="mt-1 text-sm text-stone-500">{t("account.forcedNote")}</p>
          <p className="mt-2 text-sm font-medium text-stone-700">{me.email}</p>
        </div>
        <div className={`${cardClass} p-6 shadow-sm`}>
          <ChangePasswordForm />
        </div>
        <form action={logout} className="mt-4 text-center">
          <button type="submit" className="text-sm text-stone-500 hover:text-stone-800">
            {t("common.logout")}
          </button>
        </form>
      </div>
    </main>
  );
}
