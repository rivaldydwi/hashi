import { getLocale, getTranslations } from "next-intl/server";
import { readForm55, summarizeForm55 } from "@/db/form55";
import { dateTimeIn } from "@/lib/org-time";
import type { RevisionRow } from "../queries";

export type RevField = { key: string; label: string; kind?: "text" | "time" | "ids" | "bool" | "form55" };

export const toSnake = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v instanceof Date ? v.toISOString() : v]));

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Riwayat edit: untuk tiap versi yang digantikan, siapa, kapan, dan kolom yang berubah (nilai SEBELUM dan SESUDAH berdampingan).
 * `current` = baris sekarang (kunci snake_case; boleh ditambah subject_ids/handler_ids). `names` memetakan id -> nama untuk kolom bertipe ids.
 */
export async function RevisionHistory({ revisions, current, fields, names, tz, testId = "revision-history" }: { revisions: RevisionRow[]; current: Record<string, unknown>; fields: RevField[]; names: Record<string, string>; tz: string; testId?: string }) {
  const t = await getTranslations("records");
  const locale = await getLocale();
  if (revisions.length === 0) return <p className="text-sm text-ink-2" data-testid={`${testId}-empty`}>{t("history.none")}</p>;
  const fmt = (f: RevField, v: unknown): string => {
    if (empty(v)) return "—";
    if (f.kind === "ids") return (v as string[]).map((id) => names[id] ?? id.slice(0, 8)).join(", ");
    if (f.kind === "time") return dateTimeIn(String(v), locale, tz);
    if (f.kind === "bool") return v ? t("history.yes") : t("history.no");
    if (f.kind === "form55") {
      const x = summarizeForm55(readForm55(v));
      return t("form55.summary", { answered: x.answered, problems: x.problems, nc: x.nonconformity === null ? "—" : x.nonconformity ? t("form55.yes") : t("form55.no") });
    }
    if (typeof v === "object") return JSON.stringify(v);
    const s = String(v);
    return names[s] ?? s;
  };
  const steps = revisions.map((r, i) => {
    const before = r.snapshot;
    const after = i + 1 < revisions.length ? revisions[i + 1].snapshot : current;
    const diffs = fields.filter((f) => JSON.stringify(before[f.key] ?? null) !== JSON.stringify(after[f.key] ?? null)).map((f) => ({ f, b: fmt(f, before[f.key]), a: fmt(f, after[f.key]) }));
    return { r, diffs };
  });
  return (
    <ol className="space-y-3" data-testid={testId}>
      {steps.map(({ r, diffs }) => (
        <li key={r.id} className="rounded-xl border border-line p-3" data-testid="revision-item">
          <p className="text-sm font-semibold">{t("history.step", { from: r.versionNo, to: r.versionNo + 1 })}</p>
          <p className="text-xs text-ink-2">{t("history.by", { name: r.editorName ?? "—", time: dateTimeIn(r.editedAt, locale, tz) })}</p>
          {diffs.length === 0 ? <p className="mt-1 text-xs text-ink-2">{t("history.noFieldChange")}</p> : (
            <dl className="mt-2 space-y-2">
              {diffs.map(({ f, b, a }) => (
                <div key={f.key} data-testid="revision-diff">
                  <dt className="text-xs font-semibold text-ink-menu">{f.label}</dt>
                  <dd className="grid gap-2 sm:grid-cols-2">
                    <span className="rounded-lg bg-rose-50 px-2 py-1 text-sm text-rose-900"><span className="mr-1 text-xs font-semibold">{t("history.before")}:</span><span lang="ja" className="whitespace-pre-wrap break-words" data-testid="rev-before">{b}</span></span>
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-sm text-emerald-900"><span className="mr-1 text-xs font-semibold">{t("history.after")}:</span><span lang="ja" className="whitespace-pre-wrap break-words" data-testid="rev-after">{a}</span></span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}
