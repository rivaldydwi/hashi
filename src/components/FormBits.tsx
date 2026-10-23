"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import type { FormState } from "@/lib/form-state";
import { btnPrimary } from "./styles";
import { useToast } from "./Toast";

/** Ikon berputar kecil untuk keadaan memproses (berhenti berputar bila pengguna meminta gerak berkurang). */
export function Spinner() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true" className="animate-spin"><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
}

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
    <button type="submit" disabled={pending} aria-busy={pending} className={className} name={name} value={value}>
      {pending && <Spinner />}
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
      className={`rounded-ctl border px-3 py-2 text-sm ${ok ? "border-ok-line bg-ok-bg text-ok-text" : "border-danger-line-strong bg-danger-bg text-danger-text"}`}
    >
      {t(state.key)}
    </p>
  );
}

/** Kotak kata sandi sementara, ditampilkan sekali setelah dibuat. */
export function TempPasswordNotice({ password, email }: { password: string; email: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <div className="space-y-2 rounded-ctl border border-warn-line bg-warn-bg p-4" data-testid="temp-password">
      <p className="text-sm font-medium text-warn-text">{t("users.tempTitle")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-white px-3 py-1.5 font-mono text-lg tracking-wider text-ink" data-testid="temp-password-value">
          {password}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
              toast(t("common.copied"));
            } catch {
              toast(t("common.copyFailed"), "error"); // izin papan klip ditolak: pengguna masih bisa menyalin manual
            }
          }}
          className="rounded-md border border-warn-line bg-white px-3 py-1.5 text-sm text-warn-text hover:bg-warn-bg-strong"
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <p className="text-sm text-warn-text">{t("users.tempNote", { email })}</p>
    </div>
  );
}
