import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { btnPrimary } from "@/components/styles";

/**
 * Isi halaman 404 bergaya Hashi (T-029), dipakai `app/not-found.tsx` (di luar shell) dan `app/(app)/not-found.tsx` (di dalam shell). Satu pesan untuk "tidak ada" DAN "tidak punya akses"
 * (404 hak akses TETAP 404: tidak membocorkan apakah datanya ada), tanpa rincian teknis. Menggantikan 404 bawaan Next.js yang menyisipkan gaya global (`body{color:#fff;background:#000}`
 * di peramban mode gelap) dan merusak warna shell.
 */
export async function NotFoundView() {
  const t = await getTranslations("notFoundPage");
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-line bg-card p-8 text-center" data-testid="not-found">
      <p className="text-sm font-semibold tracking-wider text-accent-text" aria-hidden="true">404</p>
      <h1 className="mt-1 text-[19px] font-semibold text-ink">{t("title")}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("body")}</p>
      <Link href="/" className={`${btnPrimary} mt-5`} data-testid="not-found-home">{t("home")}</Link>
    </div>
  );
}
