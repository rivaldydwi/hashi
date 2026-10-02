import { withSystem, withTenant } from "@/db";
import { platformOverview } from "@/db/queries";
import { skillFields } from "@/db/schema";
import {
  attentionList, decisionBars, lpkKpis, myAssessments, newCandidatesTop, openJobs, pipelineCounts, scoreTrend, stageCounts, tskKpis, unratedTop,
} from "@/db/dashboard-queries";
import { sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/session";

export type DashboardData = {
  lpk?: Awaited<ReturnType<typeof lpkKpis>>;
  tsk?: Awaited<ReturnType<typeof tskKpis>>;
  unrated?: Awaited<ReturnType<typeof unratedTop>>;
  decisions?: Awaited<ReturnType<typeof decisionBars>>;
  stages?: Awaited<ReturnType<typeof stageCounts>>;
  trend?: Awaited<ReturnType<typeof scoreTrend>>;
  mine?: Awaited<ReturnType<typeof myAssessments>>;
  attention?: Awaited<ReturnType<typeof attentionList>>;
  pipeline?: Map<string, number>;
  jobs?: Awaited<ReturnType<typeof openJobs>>;
  newCands?: Awaited<ReturnType<typeof newCandidatesTop>>;
  total?: number;
  platform?: Awaited<ReturnType<typeof platformOverview>>;
  platformCounts?: { orgs: number; users: number; fields: number };
};

/** Memuat HANYA data untuk widget yang akan ditampilkan (widget tersembunyi tidak di-query). Semua lewat withTenant/withSystem. */
export async function loadDashboard(user: CurrentUser, ids: Set<string>): Promise<DashboardData> {
  const has = (...k: string[]) => k.some((x) => ids.has(x));
  if (user.role === "SUPER_ADMIN") {
    return withSystem(async (tx) => {
      const d: DashboardData = {};
      if (has("kpi-orgs", "kpi-users", "kpi-fields", "org-list")) {
        const rows = await platformOverview(tx);
        d.platform = rows;
        const [{ n: nf }] = await tx.select({ n: sql<number>`count(*)::int` }).from(skillFields);
        d.platformCounts = { orgs: rows.length, users: rows.reduce((s, r) => s + r.users, 0), fields: nf };
      }
      return d;
    });
  }
  return withTenant({ orgId: user.organizationId, role: user.role, userId: user.id }, async (tx) => {
    const d: DashboardData = {};
    const isLpk = user.role === "LPK_ADMIN" || user.role === "LPK_SENSEI";
    if (isLpk) {
      if (has("kpi-unrated", "kpi-unshared", "kpi-passport", "kpi-incomplete")) d.lpk = await lpkKpis(tx);
      if (has("unrated-list")) d.unrated = await unratedTop(tx, 4);
      if (has("tsk-decisions")) d.decisions = await decisionBars(tx);
      if (has("stage-bar")) d.stages = await stageCounts(tx);
      if (has("score-trend")) d.trend = await scoreTrend(tx, 6);
      if (has("my-assessments")) d.mine = await myAssessments(tx, user.id, 5);
      if (has("attention")) d.attention = await attentionList(tx);
    } else {
      if (has("kpi-new-shared", "kpi-awaiting", "kpi-open-jobs", "kpi-placed")) d.tsk = await tskKpis(tx);
      if (has("pipeline")) d.pipeline = await pipelineCounts(tx);
      if (has("open-jobs")) d.jobs = await openJobs(tx, 5);
      if (has("new-candidates")) d.newCands = await newCandidatesTop(tx, 3);
    }
    return d;
  });
}
