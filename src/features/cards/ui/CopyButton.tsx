"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { btnSecondary } from "@/components/styles";

/** Tombol "Salin" (T-021): menyalin teks ke clipboard; cadangan lewat textarea sementara bila Clipboard API tidak tersedia (mis. HTTP biasa). Nilai tidak disimpan di peramban. */
export function CopyButton({ value, label, testId }: { value: string; label?: string; testId?: string }) {
  const t = useTranslations("cards.renewalData");
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2000);
  }

  return (
    <button type="button" onClick={copy} className={`${btnSecondary} !min-h-9 shrink-0 !px-3 text-xs`} data-testid={testId ?? "copy"} data-copied={done ? "true" : "false"} aria-label={label ? `${t("copy")}: ${label}` : t("copy")}>
      <span aria-live="polite">{done ? t("copied") : t("copy")}</span>
    </button>
  );
}
