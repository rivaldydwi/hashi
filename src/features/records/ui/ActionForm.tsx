"use client";

import { startTransition, useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/FormBits";
import { btnDanger, btnPrimary, btnSecondary } from "@/components/styles";
import { useToast } from "@/components/Toast";
import { idle, type FormState } from "@/lib/form-state";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/**
 * Form kecil untuk satu server action (tombol aksi, alasan pembatalan, tambah tugas, dst.). `hidden` = nilai tetap, `redirectTo` boleh memuat {id}
 * (id dari hasil action). Kesalahan tampil di dalam form (role=alert), keberhasilan lewat toast aria-live. Dikirim lewat onSubmit manual supaya
 * isian tidak dikosongkan React saat error.
 */
export function ActionForm({
  action, hidden = {}, children, className = "", submitLabel, submitTone = "primary", redirectTo, resetOnSuccess = false, testId,
}: {
  action: Action; hidden?: Record<string, string>; children?: ReactNode; className?: string; submitLabel: string; submitTone?: "primary" | "secondary" | "danger";
  redirectTo?: string; resetOnSuccess?: boolean; testId?: string;
}) {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const [state, run, pending] = useActionState<FormState, FormData>(action, idle);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state.status === "success") {
      toast(t(state.key));
      if (resetOnSuccess) setResetKey((k) => k + 1);
      if (redirectTo) router.push(redirectTo.replace("{id}", state.id ?? ""));
      else router.refresh();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const tone = submitTone === "danger" ? btnDanger : submitTone === "secondary" ? btnSecondary : btnPrimary;
  return (
    <form
      className={className}
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        startTransition(() => run(data));
      }}
      key={resetKey}
    >
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {state.status === "error" && (
        <p role="alert" className="mt-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" data-testid="form-error">{t(state.key)}</p>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${tone} mt-3`}>
        {pending && <Spinner />}
        {pending ? t("common.saving") : submitLabel}
      </button>
    </form>
  );
}
