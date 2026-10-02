import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LoginForm } from "@/components/LoginForm";
import { safeCallbackPath } from "./callback";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("tabTitle") }; // "Masuk · Hashi" lewat template di layout
}

const DEMO_ACCOUNTS = [
  "tsk.admin@hashi.test",
  "lpk1.admin@hashi.test",
  "lpk3.admin@hashi.test",
  "admin@hashi.test",
];

const check = "m5 12 4.5 4.5L19 7";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (session?.user) redirect("/");

  const t = await getTranslations("login");
  const sp = await searchParams;
  const raw = Array.isArray(sp.callbackUrl) ? sp.callbackUrl[0] : sp.callbackUrl;
  // Tampilkan daftar akun demo hanya kalau diaktifkan (jangan di production dengan data asli). Isi yang tampil sama seperti sebelumnya.
  const demo = process.env.SHOW_DEMO_ACCOUNTS === "true" ? { accounts: DEMO_ACCOUNTS, password: process.env.SEED_PASSWORD || "hashi-demo-2026" } : undefined;

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-2">
      <section className="flex min-h-screen flex-col bg-card px-4 py-6 sm:px-8 lg:px-12 lg:py-12">
        <header className="flex items-center justify-between gap-4">
          <BrandLogo variant="full" tone="light" height={32} priority />
          <div className="w-44 lg:hidden"><LanguageSwitcher /></div>
        </header>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink lg:text-[32px]">{t("heading")}</h1>
          <p className="mt-2 text-[15px] text-ink-2">{t("subheading")}</p>
          <div className="mt-8">
            <LoginForm callbackUrl={safeCallbackPath(raw)} demo={demo} />
          </div>
        </div>

        <footer className="flex items-center justify-between gap-4 text-[13px] text-ink-2">
          <div className="hidden w-48 lg:block"><LanguageSwitcher /></div>
          <span>© Hashi</span>
        </footer>
      </section>

      <aside aria-label={t("panelTitle")} className="relative hidden overflow-hidden bg-brand-navy lg:flex lg:flex-col lg:justify-center lg:px-16" data-testid="brand-panel">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-blue opacity-[0.16] blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-20 h-96 w-96 rounded-full bg-brand-coral opacity-[0.13] blur-3xl" />
        <div className="relative max-w-md">
          <BrandLogo variant="mark" tone="dark" height={96} decorative />
          <h2 className="mt-8 text-[30px] font-bold leading-tight text-white">{t("panelTitle")}</h2>
          <ul className="mt-8 space-y-4">
            {(["panel1", "panel2", "panel3"] as const).map((k) => (
              <li key={k} className="flex items-start gap-3 text-base text-[#E6EAFF]">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#C9D3FF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0"><path d={check} /></svg>
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
