import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { btnPrimary, btnSecondary, cardClass, gridTd, gridTdShort, gridTdText, gridTh, inputClass, labelClass } from "@/components/styles";
import { CARD_VIEWS, STAGE_URGENCY, countViews, isCardView, type CardStage, type CardView } from "@/db/zairyu";
import { filterCardRows, loadCardRows } from "@/db/zairyu-queries";
import { STAGE_TONE } from "@/features/cards/stage";
import { requireStaff } from "@/features/records/access";
import { Badge } from "@/features/records/ui/common";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

/** Tahap yang menampilkan tautan ke data perpanjangan online (T-021): persiapan s.d. lewat tanggal habis. */
const RENEWAL_STAGES = ["prepare", "can_apply", "h30", "h14", "h7", "expired"];

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const slash = (v: string | null) => (v ? v.replace(/-/g, "/") : "—");

/**
 * Daftar kartu izin tinggal pekerja AKTIF (T-019): kelompok (perlu tindakan, mulai disiapkan, menunggu hasil, tanpa data), "milikku" (担当 efektif), perusahaan, tahap.
 * Angka di lencana kelompok dan KPI dashboard memakai fungsi yang SAMA (`loadCardRows` + `filterCardRows`/`countViews`). Hanya staf TSK (peran lain 404).
 */
export default async function CardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireStaff();
  const t = await getTranslations("cards");
  const sp = await searchParams;
  const viewRaw = one(sp.view);
  const view: CardView = isCardView(viewRaw) ? viewRaw : "all";
  const mine = one(sp.mine) === "1";
  const companyRaw = one(sp.company);
  const companyId = UUID.test(companyRaw) ? companyRaw : null;
  const stageRaw = one(sp.stage);
  const stage = (Object.keys(STAGE_URGENCY) as CardStage[]).includes(stageRaw as CardStage) ? (stageRaw as CardStage) : null;
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const rows = await tenantQuery((tx) => loadCardRows(tx, today));
  const scope = { mineUserId: mine ? me.id : null, companyId };
  const counts = countViews(filterCardRows(rows, scope)); // lencana kelompok: dihitung pada lingkup (milikku/perusahaan) yang sama
  const shown = filterCardRows(rows, { ...scope, view, stage });
  const companies = [...new Map(rows.map((r) => [r.companyId, r.companyName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: view === "all" ? "" : view, mine: mine ? "1" : "", company: companyId ?? "", stage: stage ?? "", ...over })) if (v) p.set(k, v);
    const q = p.toString();
    return q ? `/records/cards?${q}` : "/records/cards";
  };
  const viewCount = (v: CardView) => (v === "all" ? filterCardRows(rows, scope).length : counts[v]);

  return (
    <div className="space-y-4" data-testid="cards-page">
      <div>
        <h2 className="text-[17px] font-semibold">{t("list.title")}</h2>
        <p className="text-sm text-ink-2">{t("list.intro")}</p>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label={t("list.viewsLabel")} data-testid="card-views">
        {CARD_VIEWS.map((v) => (
          <li key={v}>
            <Link href={href({ view: v === "all" ? "" : v })} aria-current={view === v ? "true" : undefined} data-testid={`card-view-${v}`} data-count={viewCount(v)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium ${view === v ? "border-accent bg-accent-soft text-accent-text" : "border-line-btn bg-card text-ink-menu hover:bg-hover"}`}>
              {t(`list.views.${v}`)} <span className="tabular-nums text-xs">{viewCount(v)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <form method="get" action="/records/cards" className={`${cardClass} flex flex-wrap items-end gap-3 p-3`} data-testid="card-filters">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={mine} className="h-5 w-5" data-testid="card-filter-mine" />{t("list.mine")}</label>
        <div className="space-y-1"><label htmlFor="cf-company" className={labelClass}>{t("list.company")}</label>
          <select id="cf-company" name="company" defaultValue={companyId ?? ""} className={inputClass} data-testid="card-filter-company"><option value="">{t("list.all")}</option>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
        <div className="space-y-1"><label htmlFor="cf-stage" className={labelClass}>{t("list.stage")}</label>
          <select id="cf-stage" name="stage" defaultValue={stage ?? ""} className={inputClass} data-testid="card-filter-stage"><option value="">{t("list.all")}</option>{(Object.keys(STAGE_URGENCY) as CardStage[]).filter((s) => s !== "done").map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}</select></div>
        <button type="submit" className={btnPrimary}>{t("list.apply")}</button>
        <Link href="/records/cards" className={btnSecondary}>{t("list.reset")}</Link>
      </form>

      <p className="text-sm text-ink-2" data-testid="card-count" data-n={shown.length}>{t("list.count", { n: shown.length })}</p>

      {shown.length === 0 ? (
        <EmptyState testId="cards-empty" title={rows.length === 0 ? t("list.emptyTitle") : t("list.noMatchTitle")} body={rows.length === 0 ? t("list.emptyBody") : t("list.noMatchBody")} action={rows.length === 0 ? undefined : { href: "/records/cards", label: t("list.reset") }} />
      ) : (
        <div className={`${cardClass} relative overflow-x-auto`}>
          <table className="w-full min-w-[56rem] border-collapse text-left" data-testid="card-table">
            <thead><tr>
              <th className={gridTh}>{t("list.cols.worker")}</th><th className={gridTh}>{t("list.cols.company")}</th><th className={gridTh}>{t("list.cols.expiry")}</th>
              <th className={gridTh}>{t("list.cols.stage")}</th><th className={gridTh}>{t("list.cols.renewal")}</th><th className={gridTh}>{t("list.cols.responsible")}</th><th className={gridTh}><span className="sr-only">{t("list.cols.open")}</span></th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.workerId} data-testid="card-row" data-worker={r.workerId} data-stage={r.stage ?? "missing"} data-responsible={r.responsibleId ?? ""} data-has-card={r.hasCard ? "true" : "false"}>
                  <th scope="row" translate="no" className={`${gridTd} cjk-phrase min-w-40 font-medium`}>
                    <Link href={`/records/workers/${r.workerId}`} className="text-accent-text hover:underline">{r.workerName}</Link>
                    {r.nameKatakana && <div lang="ja" className="text-xs font-normal text-ink-2">{r.nameKatakana}</div>}
                  </th>
                  <td translate="no" className={`${gridTdText} min-w-44`}>{r.companyName}<div className="text-xs text-ink-2">{r.siteName}</div></td>
                  <td className={gridTdShort}>
                    <span translate="no">{slash(r.expiryDate)}</span>
                    {r.daysLeft !== null && <div className="text-xs text-ink-2" data-testid="card-row-days">{r.daysLeft > 0 ? t("daysLeft", { n: r.daysLeft }) : r.daysLeft === 0 ? t("lastDay") : t("daysPast", { n: -r.daysLeft })}</div>}
                  </td>
                  <td className={`${gridTd} min-w-40`}>
                    {r.stage ? (
                      <span className="inline-flex flex-wrap items-center gap-1"><Badge tone={STAGE_TONE[r.stage]} testId="card-row-stage">{t(`stage.${r.stage}`)}</Badge>{r.additionalDocs && <Badge tone="warn">{t("flags.additionalDocsShort")}</Badge>}</span>
                    ) : <Badge tone="warn" testId="card-row-stage">{t("list.none")}</Badge>}
                    {r.specialUntil && <div className="mt-1 text-xs text-amber-900">{t("flags.special", { date: slash(r.specialUntil) })}</div>}
                  </td>
                  <td className={`${gridTd} min-w-36`}>{r.renewalStatus ? t(`renewal.${r.renewalStatus}`) : "—"}</td>
                  <td translate="no" className={`${gridTdText} min-w-28`} data-testid="card-row-responsible">{r.responsibleName ?? <span className="text-ink-2">—</span>}</td>
                  <td className={gridTdShort}>
                    <Link href={`/records/workers/${r.workerId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline" data-testid="card-row-open">{t("list.open")}</Link>
                    {RENEWAL_STAGES.includes(r.stage as never) && (me.role === "TSK_ADMIN" || r.responsibleId === me.id) && (
                      <div><Link href={`/records/workers/${r.workerId}/renewal`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline" data-testid="card-row-renewal">{t("renewalData.openShort")}</Link></div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-2">{t("list.note")}</p>
    </div>
  );
}
