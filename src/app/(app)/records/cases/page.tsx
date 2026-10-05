import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { btnPrimary, cardClass } from "@/components/styles";
import { requireStaff } from "@/features/records/access";
import { activeWorkers, listCases } from "@/features/records/queries";
import { Badge, dateLabelSync } from "@/features/records/ui/common";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tab Kasus (時系列 / Jikeiretsu): daftar kasus dengan status (teks + warna), kategori, pekerja, tanggal buka. */
export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const t = await getTranslations("records");
  const locale = await getLocale();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = ["open", "closed"].includes(one(sp.status)) ? one(sp.status) : "";
  const worker = UUID.test(one(sp.worker)) ? one(sp.worker) : "";
  const { rows, workers } = await tenantQuery(async (tx) => ({ rows: await listCases(tx, { status, workerId: worker }), workers: await activeWorkers(tx) }));
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  void tz; void ymdIn;
  const pill = (on: boolean) => `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${on ? "border-accent bg-accent-soft text-accent-text" : "border-line-btn bg-card text-ink-menu hover:bg-hover"}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/records/cases/new" className={btnPrimary} data-testid="add-case">+ {t("cases.add")}</Link>
        <span aria-hidden className="mx-1 w-px self-stretch bg-line" />
        {[["", t("cases.all")], ["open", t("cases.status.open")], ["closed", t("cases.status.closed")]].map(([v, label]) => (
          <Link key={v} href={`/records/cases${v ? `?status=${v}` : ""}${worker ? `${v ? "&" : "?"}worker=${worker}` : ""}`} className={pill(status === v)} aria-current={status === v ? "true" : undefined} data-testid={`case-status-${v || "all"}`}>{label}</Link>
        ))}
        {worker && <Link href="/records/cases" className={pill(true)} data-testid="case-worker-chip">{t("filters.worker", { v: workers.find((w) => w.id === worker)?.fullName ?? "" })} ×</Link>}
      </div>
      {rows.length === 0 ? (
        <EmptyState testId="cases-empty" title={t("cases.emptyTitle")} body={t("cases.emptyBody")} action={{ href: "/records/cases/new", label: `+ ${t("cases.add")}` }} />
      ) : (
        <ul className={`${cardClass} divide-y divide-line`} data-testid="case-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/records/cases/${c.id}`} className="block px-4 py-3 hover:bg-hover" data-testid="case-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-2">{c.code}</span>
                  <span lang="ja" className="text-sm font-semibold">{c.title}</span>
                  <Badge tone={c.status === "open" ? "warn" : "ok"} testId="case-status">{c.status === "open" ? "● " : "✓ "}{t(`cases.status.${c.status}`)}</Badge>
                  <Badge>{t(`categories.${c.category}`)}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-2">{t("cases.openedOn", { date: dateLabelSync(ymdIn(c.openedAt, tz), locale) })}{c.workers.length > 0 && ` · ${c.workers.join(", ")}`}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
