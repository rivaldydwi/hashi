import { withSystem, withTenant } from "@/db";
import { platformOverview } from "@/db/queries";
import { skillFields } from "@/db/schema";
import {
  attentionList, decisionBars, lpkKpis, myAssessments, newCandidatesTop, openJobs, pipelineCounts, scoreTrend, stageCounts, tskKpis, unratedTop,
} from "@/db/dashboard-queries";
import { sql } from "drizzle-orm";
import { recentAudit } from "@/db/audit-history";
import type { AuditView } from "@/db/audit-describe";
import { and, asc, eq } from "drizzle-orm";
import { activityFollowups } from "@/db/schema";
import { followupIds, openCases, openInterviewQuarters, unreadRecordIds, unreadReportIds } from "@/db/records-queries";
import { responsibilityOverview } from "@/db/responsibility-queries";
import { safeTimezone, ymdIn } from "@/lib/org-time";
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
  activity?: AuditView[];
  resp?: { over: number; unassigned: number };
  rec?: { records: number; reports: number; interviews: number; followups: number; followupsScope: "all" | "mine" };
  myTasks?: Array<{ id: string; description: string; dueDate: string | null; recordId: string | null; caseId: string | null; interviewId: string | null }>;
  casesOpen?: Awaited<ReturnType<typeof openCases>>;
  today?: string;
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
      // Catatan kegiatan (langkah 7A): angka KPI = fungsi yang sama dengan daftar/lencana
      const today = ymdIn(new Date(), safeTimezone(user.organizationTimezone, user.organizationType));
      d.today = today;
      if (has("kpi-records-unread", "kpi-interviews-pending", "kpi-followups-open")) {
        const scope = user.role === "TSK_ADMIN" ? "all" : "mine";
        d.rec = {
          records: has("kpi-records-unread") ? (await unreadRecordIds(tx, user.id)).length : 0,
          reports: has("kpi-records-unread") ? (await unreadReportIds(tx, user.id)).length : 0,
          interviews: has("kpi-interviews-pending") ? (await openInterviewQuarters(tx, today)).length : 0,
          followups: has("kpi-followups-open") ? (await followupIds(tx, scope === "mine" ? { userId: user.id } : {})).length : 0,
          followupsScope: scope,
        };
      }
      if (has("kpi-staff-over", "kpi-unassigned")) {
        // sama dengan daftar di /records/responsible (satu fungsi: responsibilityOverview)
        const ov = await responsibilityOverview(tx, today);
        d.resp = { over: ov.overLimit.length, unassigned: ov.unassigned.length };
      }
      if (has("my-followups")) {
        d.myTasks = await tx.select({ id: activityFollowups.id, description: activityFollowups.description, dueDate: activityFollowups.dueDate, recordId: activityFollowups.recordId, caseId: activityFollowups.caseId, interviewId: activityFollowups.interviewId })
          .from(activityFollowups).where(and(eq(activityFollowups.status, "open"), eq(activityFollowups.assigneeId, user.id))).orderBy(asc(activityFollowups.dueDate), asc(activityFollowups.createdAt)).limit(5);
      }
      if (has("open-cases")) d.casesOpen = await openCases(tx, 5);
    }
    if (has("activity")) d.activity = await recentAudit(tx, 6);
    return d;
  });
}
