import Link from "next/link";
import { btnPrimary, btnSecondary, cardClass } from "./styles";

/** Keadaan kosong yang membantu: ikon, judul, penjelasan, dan SATU langkah berikutnya (tautan). */
export function EmptyState({ title, body, action, secondary, testId }: { title: string; body?: string; action?: { href: string; label: string }; secondary?: { href: string; label: string }; testId?: string }) {
  return (
    <div className={`${cardClass} flex flex-col items-center gap-2 px-6 py-10 text-center`} data-testid={testId}>
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h10M4 17h6" /></svg>
      </span>
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      {body && <p className="max-w-md text-sm text-ink-2">{body}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {action && <Link href={action.href} className={btnPrimary}>{action.label}</Link>}
        {secondary && <Link href={secondary.href} className={btnSecondary}>{secondary.label}</Link>}
      </div>
    </div>
  );
}
