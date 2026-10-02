import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { btnPrimary, btnSecondary, cardClass } from "@/components/styles";

/** LPK_ADMIN tanpa kandidat: tiga langkah awal. */
export async function Onboarding({ name }: { name: string }) {
  const t = await getTranslations("dashboard.onboarding");
  const steps = [
    { key: "s1", href: "/users", cta: "s1Cta", secondary: true },
    { key: "s2", href: "/candidates/new", cta: "s2Cta", secondary: false },
    { key: "s3", href: "/candidates", cta: "s3Cta", secondary: true },
  ] as const;
  return (
    <div className="space-y-6" data-testid="onboarding">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title", { name })}</h1>
        <p className="mt-1 text-sm text-ink-2">{t("intro")}</p>
      </div>
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.key} className={`${cardClass} flex flex-col p-5`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-text">{i + 1}</span>
            <h2 className="mt-3 text-[17px] font-semibold">{t(`${s.key}Title`)}</h2>
            <p className="mt-1 flex-1 text-sm text-ink-2">{t(`${s.key}Body`)}</p>
            <Link href={s.href} className={`${s.secondary ? btnSecondary : btnPrimary} mt-4 self-start`}>{t(s.cta)}</Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
