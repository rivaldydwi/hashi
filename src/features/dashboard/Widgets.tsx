import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import { DecisionBadge } from "@/components/DecisionBadge";
import { selectionDecision, candidateStage } from "@/db/schema";
import { AuditList } from "@/features/audit/AuditList";
import type { DashboardData } from "./data";
import { widgetById } from "./catalog";

const num = (n: number) => String(n);

function Kpi({ href, label, value, hint, testid }: { href: string; label: string; value: number; hint?: string; testid: string }) {
  return (
    <Link href={href} data-testid={testid} className={`${cardClass} block min-h-11 p-5 hover:bg-hover`}>
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-2 text-4xl font-bold tabular-nums text-ink" data-testid={`${testid}-value`}>{num(value)}</p>
      {hint && <p className="mt-1 text-xs text-ink-2">{hint}</p>}
    </Link>
  );
}

function Card({ title, href, linkLabel, children, testid }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode; testid: string }) {
  return (
    <section className={`${cardClass} p-5`} data-testid={testid}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        {href && <Link href={href} className="inline-flex min-h-11 items-center text-sm font-medium text-accent-text hover:underline">{linkLabel}</Link>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const fmtAvg = (v: number | null) => (v == null ? "—" : v.toFixed(1));

/** Grafik garis SVG sederhana: skala 1–5, satu garis per aspek, warna + gaya garis berbeda (tidak bergantung warna saja). */
function TrendChart({ rows, labels }: { rows: NonNullable<DashboardData["trend"]>; labels: Record<"japanese" | "attitude" | "fitness" | "motivation", string> }) {
  const W = 320, H = 140, pad = 24;
  const keys = ["japanese", "attitude", "fitness", "motivation"] as const;
  const colors = ["#C2410C", "#2F5D8A", "#8C8378", "#7C2D12"];
  const dash = ["", "6 3", "2 3", "10 3 2 3"];
  const x = (i: number) => pad + (rows.length <= 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (rows.length - 1));
  const y = (v: number) => H - pad - ((v - 1) / 4) * (H - 2 * pad);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={keys.map((k) => labels[k]).join(", ")} className="h-auto w-full">
        {[1, 3, 5].map((v) => (
          <g key={v}>
            <line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="#E8E3DC" />
            <text x={4} y={y(v) + 4} fontSize="10" fill="#6B645B">{v}</text>
          </g>
        ))}
        {keys.map((k, ki) => {
          const pts = rows.map((r, i) => (r[k] == null ? null : ([x(i), y(r[k] as number)] as const)));
          const line = pts.filter(Boolean).map((p) => p!.join(",")).join(" ");
          return (
            <g key={k}>
              <polyline points={line} fill="none" stroke={colors[ki]} strokeWidth="2" strokeDasharray={dash[ki]} />
              {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={colors[ki]} />)}
            </g>
          );
        })}
        {rows.map((r, i) => (
          <text key={r.period} x={x(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="#6B645B">{r.period.slice(5, 7)}</text>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {keys.map((k, i) => (
          <li key={k} className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={colors[i]} strokeWidth="2" strokeDasharray={dash[i]} /></svg>
            {labels[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({ label, n, max, href }: { label: React.ReactNode; n: number; max: number; href?: string }) {
  const inner = (
    <div className="flex min-h-11 items-center gap-3 text-sm">
      <span className="w-40 shrink-0 text-ink-menu">{label}</span>
      <span className="h-2.5 flex-1 rounded-full bg-hover" aria-hidden="true">
        <span className="block h-2.5 rounded-full bg-accent" style={{ width: `${max === 0 ? 0 : Math.round((n / max) * 100)}%` }} />
      </span>
      <span className="w-8 text-right font-medium tabular-nums">{n}</span>
    </div>
  );
  return href ? <Link href={href} className="block rounded-xl hover:bg-hover">{inner}</Link> : inner;
}

export async function Widget({ id, data, timezone }: { id: string; data: DashboardData; timezone?: string }) {
  const t = await getTranslations("dashboard");
  const tDec = await getTranslations("decisions");
  const tStage = await getTranslations("stages");
  const tType = await getTranslations("orgTypes");
  const locale = await getLocale();
  const def = widgetById(id);
  if (!def) return null;
  const list = (rows: React.ReactNode[], empty: string) => (rows.length === 0 ? <p className="text-sm text-ink-2">{empty}</p> : <ul className="divide-y divide-line">{rows}</ul>);

  switch (id) {
    // ---- KPI LPK
    case "kpi-unrated": return <Kpi testid="kpi-unrated" href="/candidates?view=unrated" label={t("kpiUnrated")} value={data.lpk!.unrated} hint={t("kpiUnratedHint")} />;
    case "kpi-unshared": return <Kpi testid="kpi-unshared" href="/candidates?view=unshared" label={t("kpiUnshared")} value={data.lpk!.unshared} hint={t("kpiUnsharedHint")} />;
    case "kpi-passport": return <Kpi testid="kpi-passport" href="/candidates?view=passport" label={t("kpiPassport")} value={data.lpk!.passportSoon} hint={t("kpiPassportHint", { n: data.lpk!.passportExpired })} />;
    case "kpi-incomplete": return <Kpi testid="kpi-incomplete" href="/candidates?view=incomplete" label={t("kpiIncomplete")} value={data.lpk!.incomplete} hint={t("kpiIncompleteHint")} />;
    // ---- KPI TSK
    case "kpi-new-shared": return <Kpi testid="kpi-new-shared" href="/candidates?view=new-shared" label={t("kpiNewShared")} value={data.tsk!.newShared} hint={t("kpiNewSharedHint")} />;
    case "kpi-awaiting": return <Kpi testid="kpi-awaiting" href="/candidates?view=awaiting" label={t("kpiAwaiting")} value={data.tsk!.awaiting} hint={t("kpiAwaitingHint")} />;
    case "kpi-open-jobs": return <Kpi testid="kpi-open-jobs" href="/job-orders?status=OPEN" label={t("kpiOpenJobs")} value={data.tsk!.openJobs} hint={t("kpiOpenJobsHint", { n: data.tsk!.openPositionsLeft })} />;
    case "kpi-placed": return <Kpi testid="kpi-placed" href="/candidates?view=placed" label={t("kpiPlaced")} value={data.tsk!.placed} hint={t("kpiPlacedHint")} />;
    // ---- KPI super admin
    case "kpi-orgs": return <Kpi testid="kpi-orgs" href="/organizations" label={t("kpiOrgs")} value={data.platformCounts!.orgs} />;
    case "kpi-users": return <Kpi testid="kpi-users" href="/organizations" label={t("kpiUsers")} value={data.platformCounts!.users} />;
    case "kpi-fields": return <Kpi testid="kpi-fields" href="/admin/skill-fields" label={t("kpiFields")} value={data.platformCounts!.fields} />;

    case "unrated-list":
      return (
        <Card testid="w-unrated-list" title={t("wUnrated")} href="/candidates?view=unrated" linkLabel={t("viewAll")}>
          {list(data.unrated!.map((c) => (
            <li key={c.id}>
              <Link href={`/candidates/${c.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-hover">
                <span>
                  <span className="font-medium">{c.fullName}</span>
                  {c.nameKatakana && <span className="block text-xs text-ink-2">{c.nameKatakana}</span>}
                </span>
                <span className="text-sm text-ink-2">{t("latestAvg")}: <span className="font-medium tabular-nums text-ink">{fmtAvg(c.latestAvg)}</span></span>
              </Link>
            </li>
          )), t("emptyUnrated"))}
        </Card>
      );
    case "tsk-decisions": {
      const rows = data.decisions!.filter((r) => r.decision !== "NONE");
      const max = Math.max(0, ...rows.map((r) => r.n));
      return (
        <Card testid="w-tsk-decisions" title={t("wDecisions")}>
          {rows.length === 0 ? <p className="text-sm text-ink-2">{t("emptyDecisions")}</p> : selectionDecision.enumValues.filter((d) => d !== "NONE").map((d) => {
            const n = rows.find((r) => r.decision === d)?.n ?? 0;
            return <Bar key={d} label={tDec(d)} n={n} max={max} />;
          })}
        </Card>
      );
    }
    case "stage-bar": {
      const by = new Map(data.stages!.map((r) => [r.stage, r.n]));
      const max = Math.max(0, ...data.stages!.map((r) => r.n));
      return (
        <Card testid="w-stage-bar" title={t("wStages")} href="/candidates" linkLabel={t("viewAll")}>
          {candidateStage.enumValues.map((s) => <Bar key={s} label={tStage(s)} n={by.get(s) ?? 0} max={max} href={`/candidates?stage=${s}`} />)}
        </Card>
      );
    }
    case "score-trend":
      return (
        <Card testid="w-score-trend" title={t("wTrend")}>
          {data.trend!.length === 0 ? <p className="text-sm text-ink-2">{t("emptyTrend")}</p> : (
            <TrendChart rows={data.trend!} labels={{ japanese: t("aspectJapanese"), attitude: t("aspectAttitude"), fitness: t("aspectFitness"), motivation: t("aspectMotivation") }} />
          )}
        </Card>
      );
    case "my-assessments":
      return (
        <Card testid="w-my-assessments" title={t("wMine")}>
          {list(data.mine!.map((r) => (
            <li key={r.id}>
              <Link href={`/candidates/${r.candidate_id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-hover">
                <span className="font-medium">{r.full_name}</span>
                <span className="text-sm text-ink-2">{r.assessed_on} · <span className="font-medium tabular-nums text-ink">{fmtAvg(r.avg)}</span></span>
              </Link>
            </li>
          )), t("emptyMine"))}
        </Card>
      );
    case "attention":
      return (
        <Card testid="w-attention" title={t("wAttention")}>
          <p className="mb-2 text-xs text-ink-2">{t("attentionHint")}</p>
          {list(data.attention!.map((r) => (
            <li key={r.id}>
              <Link href={`/candidates/${r.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-hover">
                <span className="font-medium">{r.full_name}</span>
                <span className="text-sm text-ink-2">
                  {r.attendance_pct != null && r.attendance_pct < 80 ? t("attLow", { n: r.attendance_pct }) : t("scoreDown")}
                </span>
              </Link>
            </li>
          )), t("emptyAttention"))}
        </Card>
      );
    case "pipeline": {
      const order = selectionDecision.enumValues.filter((d) => d !== "REJECTED");
      const max = Math.max(0, ...order.map((d) => data.pipeline!.get(d) ?? 0));
      return (
        <Card testid="w-pipeline" title={t("wPipeline")} href="/candidates" linkLabel={t("viewAll")}>
          {order.map((d) => <Bar key={d} label={tDec(d)} n={data.pipeline!.get(d) ?? 0} max={max} href={`/candidates?decision=${d}`} />)}
        </Card>
      );
    }
    case "open-jobs":
      return (
        <Card testid="w-open-jobs" title={t("wJobs")} href="/job-orders?status=OPEN" linkLabel={t("viewAll")}>
          {list(data.jobs!.map((j) => (
            <li key={j.id}>
              <Link href={`/job-orders/${j.id}`} className="block min-h-11 py-2 hover:bg-hover">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{j.title}</span>
                  <span className="text-sm tabular-nums text-ink-2">{j.selected}/{j.positions}</span>
                </span>
                <span className="block text-xs text-ink-2">{j.company_name} · {locale === "ja" ? j.name_ja : j.name_id}</span>
              </Link>
            </li>
          )), t("emptyJobs"))}
        </Card>
      );
    case "new-candidates":
      return (
        <Card testid="w-new-candidates" title={t("wNewCands")} href="/candidates?view=new-shared" linkLabel={t("viewAll")}>
          {list(data.newCands!.map((c) => (
            <li key={c.id}>
              <Link href={`/candidates/${c.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-hover">
                <span>
                  <span className="font-medium">{c.fullName}</span>
                  <span className="block text-xs text-ink-2">{c.lpkName} · {(locale === "ja" ? c.fieldNameJa : c.fieldNameId) ?? "—"}{c.jlpt ? ` · ${c.jlpt}` : ""}</span>
                </span>
                <span className="text-sm tabular-nums text-ink-2">{fmtAvg(c.latestAvg)}</span>
              </Link>
            </li>
          )), t("emptyNewCands"))}
        </Card>
      );
    case "kpi-records-unread": return <Kpi testid="kpi-records-unread" href="/records?view=unread" label={t("kpiRecordsUnread")} value={data.rec!.records + data.rec!.reports} hint={t("kpiRecordsUnreadHint", { r: data.rec!.records, l: data.rec!.reports })} />;
    case "kpi-interviews-pending": return <Kpi testid="kpi-interviews-pending" href="/records/interviews?view=pending" label={t("kpiInterviewsPending")} value={data.rec!.interviews} hint={t("kpiInterviewsPendingHint")} />;
    case "kpi-followups-open": return <Kpi testid="kpi-followups-open" href={`/records/tasks?scope=${data.rec!.followupsScope}&status=open`} label={t("kpiFollowupsOpen")} value={data.rec!.followups} hint={t(data.rec!.followupsScope === "all" ? "kpiFollowupsOpenAll" : "kpiFollowupsOpenMine")} />;
    case "my-followups":
      return (
        <Card testid="w-my-followups" title={t("wMyFollowups")} href="/records/tasks?scope=mine&status=open" linkLabel={t("viewAll")}>
          {list(data.myTasks!.map((f) => (
            <li key={f.id}>
              <Link href={f.recordId ? `/records/${f.recordId}` : f.caseId ? `/records/cases/${f.caseId}` : "/records/tasks"} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-hover">
                <span lang="ja" className="line-clamp-2 text-sm">{f.description}</span>
                <span className={`shrink-0 text-xs ${f.dueDate && f.dueDate < (data.today ?? "") ? "font-semibold text-rose-800" : "text-ink-2"}`}>{f.dueDate ? `${f.dueDate < (data.today ?? "") ? "⚠ " : ""}${f.dueDate}` : ""}</span>
              </Link>
            </li>
          )), t("emptyMyFollowups"))}
        </Card>
      );
    case "open-cases":
      return (
        <Card testid="w-open-cases" title={t("wOpenCases")} href="/records/cases?status=open" linkLabel={t("viewAll")}>
          {list(data.casesOpen!.map((c) => (
            <li key={c.id}>
              <Link href={`/records/cases/${c.id}`} className="flex min-h-11 items-center gap-3 py-2 hover:bg-hover"><span className="font-mono text-xs text-ink-2">{c.code}</span><span lang="ja" className="text-sm font-medium">{c.title}</span></Link>
            </li>
          )), t("emptyOpenCases"))}
        </Card>
      );
    case "coming-soon":
      return (
        <Card testid="w-coming-soon" title={t("wSoon")}>
          <ul className="space-y-2 text-sm text-ink-menu">
            <li className="flex min-h-11 items-center justify-between"><span>{t("soonResidence")}</span><span className="rounded-full bg-hover px-2.5 py-0.5 text-xs text-ink-2">{t("soonBadge")}</span></li>
          </ul>
        </Card>
      );
    case "activity":
      return (
        <Card testid="w-activity" title={t("wActivity")} href="/activity" linkLabel={t("viewAll")}>
          <AuditList rows={data.activity ?? []} timezone={timezone ?? "Asia/Jakarta"} emptyText={t("emptyActivity")} testId="w-activity-list" />
        </Card>
      );
    case "org-list":
      return (
        <Card testid="w-org-list" title={t("platformTitle")}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-2">
                <tr>
                  <th className="py-2 pr-4 font-medium">{t("colOrg")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colType")}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t("colUsers")}</th>
                  <th className="py-2 text-right font-medium">{t("colCandidates")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.platform!.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-medium">{r.name}</td>
                    <td className="py-3 pr-4 text-ink-menu">{tType(r.type)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{r.users}</td>
                    <td className="py-3 text-right tabular-nums">{r.candidates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      );
  }
  void DecisionBadge;
  return null;
}
