"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { btnSecondary } from "@/components/styles";
import { revealCardNumber } from "../secret-actions";
import { CopyButton } from "./CopyButton";

const SHOW_SECONDS = 30;

/**
 * Nomor kartu tersamar + tombol "Tampilkan" (T-020). Nomor lengkap TIDAK ada di HTML awal: diminta lewat server action yang mencatat audit lebih dulu,
 * ditampilkan di memori komponen saja (tanpa penyimpanan peramban), lalu disembunyikan otomatis setelah 30 detik atau saat berpindah halaman.
 */
export function NumberReveal({ cardId, masked }: { cardId: string; masked: string }) {
  const t = useTranslations();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setValue(null);
  };

  return (
    <div className="space-y-1" data-testid="card-number">
      <div className="flex flex-wrap items-center gap-3">
        {value === null ? (
          <span className="font-mono text-base tracking-wider" translate="no" data-testid="card-number-masked">{masked}</span>
        ) : (
          <span className="font-mono text-base font-semibold tracking-wider" translate="no" data-testid="card-number-value">{value}</span>
        )}
        {value === null ? (
          <button
            type="button"
            className={btnSecondary}
            disabled={pending}
            aria-busy={pending}
            data-testid="card-number-show"
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await revealCardNumber(cardId);
                if (!r.ok) return setError(r.key);
                setValue(r.number);
                timer.current = setTimeout(() => setValue(null), SHOW_SECONDS * 1000);
              })
            }
          >
            {t("cards.secrets.show")}
          </button>
        ) : (
          <>
            <CopyButton value={value} testId="card-number-copy" />
          <button type="button" className={btnSecondary} onClick={hide} data-testid="card-number-hide">{t("cards.secrets.hide")}</button>
          </>
        )}
      </div>
      <p className="text-xs text-ink-2">{value === null ? t("cards.secrets.showHelp") : t("cards.secrets.shownFor", { n: SHOW_SECONDS })}</p>
      {error && <p role="alert" className="text-sm text-rose-900" data-testid="card-number-error">{t(error)}</p>}
    </div>
  );
}
