import { getTranslations } from "next-intl/server";
import type { CandidateStage, SelectionDecision } from "@/db/schema";

// Lencana status: IKON + TEKS + warna (warna tidak pernah satu-satunya pembeda) + penjelasan singkat (title dan teks bantuan untuk pembaca layar).
// Kontras teks/latar >= 4,5:1 (kelas 800/900 di atas latar 50/100).

export type StatusKind = "stage" | "decision";
export type StatusCode = CandidateStage | SelectionDecision;

type Style = { box: string; icon: string };
const STYLES: Record<StatusCode, Style> = {
  STUDYING: { box: "bg-stone-100 text-stone-800", icon: "book" },
  READY: { box: "bg-sky-50 text-sky-900", icon: "check" },
  WITHDRAWN: { box: "bg-rose-50 text-rose-900", icon: "exit" },
  NONE: { box: "bg-stone-100 text-stone-800", icon: "dash" },
  SHORTLISTED: { box: "bg-indigo-50 text-indigo-900", icon: "star" },
  PASSED_TSK_INTERVIEW: { box: "bg-violet-50 text-violet-900", icon: "chat" },
  SUBMITTED_TO_CLIENT: { box: "bg-amber-50 text-amber-900", icon: "send" },
  PASSED_CLIENT_INTERVIEW: { box: "bg-emerald-50 text-emerald-900", icon: "check" },
  DOCUMENT_PROCESS: { box: "bg-teal-50 text-teal-900", icon: "doc" },
  DEPARTED: { box: "bg-green-100 text-green-900", icon: "plane" },
  REJECTED: { box: "bg-rose-50 text-rose-900", icon: "x" },
};

const ICONS: Record<string, string> = {
  book: "M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Zm4 0v8l2-1.5L12 13V5",
  check: "m5 12 4.5 4.5L19 7",
  exit: "M10 4H6v16h4M15 8l4 4-4 4M9 12h10",
  dash: "M6 12h12",
  star: "m12 4 2.4 5 5.6.8-4 3.9.9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-3.9 5.6-.8L12 4Z",
  chat: "M5 5h14v10H9l-4 4V5Z",
  send: "m4 12 16-8-6 16-3-6-7-2Z",
  doc: "M7 3h7l4 4v14H7V3Zm7 0v4h4M10 12h5M10 16h5",
  plane: "m3 13 18-8-6 16-3-7-9-1Z",
  x: "m6 6 12 12M18 6 6 18",
};

function StatusIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Lencana status kandidat (stage LPK) atau keputusan TSK. `decision = null` ditampilkan sebagai NONE. */
export async function StatusBadge({ kind, code }: { kind: StatusKind; code: StatusCode | null }) {
  const t = await getTranslations(kind === "stage" ? "stages" : "decisions");
  const tHelp = await getTranslations("statusHelp");
  const value = (code ?? "NONE") as StatusCode;
  const st = STYLES[value];
  return (
    <span title={tHelp(value)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.box}`}>
      <StatusIcon name={st.icon} />
      {t(value as never)}
      <span className="sr-only">. {tHelp(value)}</span>
    </span>
  );
}

/** Legenda semua status (dilipat): nama + penjelasan; dipakai di halaman daftar kandidat. */
export async function StatusLegend({ kind }: { kind: StatusKind }) {
  const t = await getTranslations("statusHelp");
  const codes: StatusCode[] = kind === "stage" ? ["STUDYING", "READY", "WITHDRAWN"] : ["NONE", "SHORTLISTED", "PASSED_TSK_INTERVIEW", "SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED", "REJECTED"];
  return (
    <details className="mb-4 rounded-2xl border border-line bg-card" data-testid={`legend-${kind}`}>
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-ink-menu">{t(kind === "stage" ? "legendStage" : "legendDecision")}</summary>
      <ul className="divide-y divide-line border-t border-line">
        {codes.map((c) => (
          <li key={c} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="w-52 shrink-0"><StatusBadge kind={kind} code={c} /></span>
            <span className="min-w-0 flex-1 text-sm text-ink-2">{t(c)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
