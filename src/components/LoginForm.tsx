"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { login, type LoginState } from "@/app/login/actions";
import { Spinner } from "@/components/FormBits";

type Demo = { accounts: string[]; password: string };

const eye = "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z";
const eyeOff = "M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.7C3.9 9.4 2 12 2 12s3.6 7 10 7c1.5 0 2.8-.3 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2";

/**
 * Form login. Perilaku autentikasi ada di action `login` (tidak berubah). Dikirim lewat onSubmit manual (React mengosongkan form uncontrolled setelah
 * form-action selesai): email dipertahankan saat gagal, kata sandi dikosongkan dan fokus kembali ke kata sandi. Kata sandi hanya hidup di state ini dan
 * dikirim ke action; tombol tampilkan/sembunyikan hanya mengubah `type` input.
 */
export function LoginForm({ callbackUrl, demo }: { callbackUrl: string; demo?: Demo }) {
  const t = useTranslations("login");
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.error) {
      setPassword("");
      passwordRef.current?.focus();
    }
  }, [state]);

  const input = "block h-12 w-full rounded-xl border border-line-btn bg-card px-3.5 text-[15px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
        className="space-y-5"
        data-testid="login-form"
      >
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-[13px] font-medium text-ink-menu">{t("email")}</label>
          <input id="email" name="email" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-menu">{t("password")}</label>
          <div className="relative">
            <input id="password" name="password" ref={passwordRef} type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} pr-12`} />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-pressed={show}
              aria-label={show ? t("hidePassword") : t("showPassword")}
              data-testid="toggle-password"
              className="absolute right-0 top-0 inline-flex h-12 w-12 items-center justify-center rounded-xl text-ink-2 hover:text-ink"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={show ? eyeOff : eye} /></svg>
            </button>
          </div>
        </div>

        {state?.error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-sm text-rose-900" data-testid="login-error">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
            <span>{t(state.error)}</span>
          </p>
        )}

        <button type="submit" disabled={pending} aria-busy={pending} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-white transition hover:bg-accent-dark disabled:opacity-70">
          {pending && <Spinner />}
          {pending ? t("submitting") : t("submit")}
        </button>
      </form>

      <p className="mt-5 text-[13px] text-ink-2">{t("forgot")}</p>

      {demo && (
        <details className="mt-6 rounded-xl border border-dashed border-line-btn p-4 text-sm text-ink-menu" data-testid="demo-accounts">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">{t("demoTitle")}</summary>
          <p className="mt-1 text-xs text-ink-2">{t("demoHint")}</p>
          <ul className="mt-2 space-y-1">
            {demo.accounts.map((a) => (
              <li key={a}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(a);
                    passwordRef.current?.focus();
                  }}
                  className="inline-flex min-h-11 w-full items-center rounded-lg px-2 text-left font-mono text-xs hover:bg-hover"
                >
                  {a}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">{t("demoPassword", { password: demo.password })}</p>
        </details>
      )}
    </>
  );
}
