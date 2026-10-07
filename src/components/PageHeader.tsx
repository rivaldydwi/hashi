import Link from "next/link";

export function PageHeader({
  title,
  intro,
  action,
  backHref,
  backLabel,
  titleIsData,
  introIsData,
}: {
  title: string;
  intro?: string;
  action?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Judul / pengantar berisi DATA (nama kandidat, katakana): tidak ikut terjemahan peramban (T-016). */
  titleIsData?: boolean;
  introIsData?: boolean;
}) {
  return (
    <div className="mb-6 space-y-2">
      {backHref && (
        <Link href={backHref} className="text-sm text-stone-500 hover:text-stone-800">
          ← {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" translate={titleIsData ? "no" : undefined}>{title}</h1>
          {intro && <p className="mt-1 text-sm text-stone-500" translate={introIsData ? "no" : undefined} lang={introIsData ? "ja" : undefined}>{intro}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
