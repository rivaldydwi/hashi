import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "Login" };

const DEMO_ACCOUNTS = [
  "tsk.admin@hashi.test",
  "lpk1.admin@hashi.test",
  "lpk3.admin@hashi.test",
  "admin@hashi.test",
];

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  const t = await getTranslations();
  // Tampilkan daftar akun demo hanya kalau diaktifkan (jangan di production dengan data asli).
  const showDemo = process.env.SHOW_DEMO_ACCOUNTS === "true";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-stone-500">{t("common.tagline")}</p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>

        {showDemo && (
          <div className="mt-4 rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600">
            <p className="font-medium text-stone-800">{t("login.demoTitle")}</p>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {DEMO_ACCOUNTS.map((email) => (
                <li key={email}>{email}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              {t("login.demoPassword", { password: process.env.SEED_PASSWORD || "hashi-demo-2026" })}
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </main>
  );
}
