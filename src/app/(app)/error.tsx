"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { btnPrimary } from "@/components/styles";

// Batas galat untuk semua halaman di (app): pesan manusiawi, tombol coba lagi, dan kode galat (digest) untuk dilaporkan. Isi galat teknis TIDAK ditampilkan.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorPage");
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-2xl border border-rose-300 bg-rose-50 p-6 text-center" data-testid="error-boundary">
      <h1 className="text-[17px] font-semibold text-rose-900">{t("title")}</h1>
      <p className="mt-2 text-sm text-rose-900">{t("body")}</p>
      {error.digest && <p className="mt-2 text-xs text-ink-2">{t("code")}: <code>{error.digest}</code></p>}
      <button type="button" onClick={reset} className={`${btnPrimary} mt-4`}>{t("retry")}</button>
    </div>
  );
}
