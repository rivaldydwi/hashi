"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import type { FormState } from "@/lib/form-state";
import { btnPrimary } from "./styles";

/** Tombol submit yang otomatis nonaktif selama form diproses. */
export function SubmitButton({
  children,
  className = btnPrimary,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  return (
    <button type="submit" disabled={pending} className={className} name={name} value={value}>
      {pending ? t("saving") : children}
    </button>
  );
}

/** Pesan sukses/error dari server action. */
export function FormAlert({ state }: { state: FormState }) {
  const t = useTranslations();
  if (state.status === "idle") return null;
  const ok = state.status === "success";
  return (
    <p
      role={ok ? "status" : "alert"}
      className={`rounded-lg px-3 py-2 text-sm ${ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
    >
      {t(state.key)}
    </p>
  );
}

/** Kotak kata sandi sementara, ditampilkan sekali setelah dibuat. */
export function TempPasswordNotice({ password, email }: { password: string; email: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid="temp-password">
      <p className="text-sm font-medium text-amber-900">{t("users.tempTitle")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-white px-3 py-1.5 font-mono text-lg tracking-wider text-stone-900" data-testid="temp-password-value">
          {password}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(password);
            setCopied(true);
          }}
          className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <p className="text-sm text-amber-900">{t("users.tempNote", { email })}</p>
    </div>
  );
}
