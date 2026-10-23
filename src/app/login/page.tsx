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
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink lg:text-[32px]">{t("title")}</h1>
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

      {/* Panel merek (T-036): logo + satu kalimat. Tanpa daftar fitur dan efek cahaya: halaman ini untuk masuk, bukan promosi. */}
      <aside aria-label={t("panelTitle")} className="hidden bg-brand-navy lg:flex lg:flex-col lg:justify-center lg:px-16" data-testid="brand-panel">
        <div className="max-w-md">
          <BrandLogo variant="mark" tone="dark" height={96} decorative />
          <p className="mt-8 text-[28px] font-semibold leading-snug text-white">{t("panelTitle")}</p>
        </div>
      </aside>
    </main>
  );
}
