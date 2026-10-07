import type { KpiTone } from "./dashboard-kpi";
import type { Role } from "./schema";

export type WidgetSize = "half" | "full";
export type WidgetDef = {
  id: string;
  /** kpi = kartu angka (grid otomatis menurut lebar, hanya bisa disembunyikan); widget = 6 kolom (setengah) atau 12 kolom (penuh). */
  kind: "kpi" | "widget";
  roles: readonly Role[];
  /** Ukuran yang diizinkan (kosong untuk KPI). */
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** Kunci pesan label (namespace dashboard), dipakai mode atur. */
  label: string;
  /** Hanya KPI: nada dasar (lihat `kpiLook`) dan nama ikon (`Icon`); wajib untuk setiap KPI (dites unit). */
  tone?: KpiTone;
  icon?: string;
};

const LPK_A: Role[] = ["LPK_ADMIN"];
const LPK_S: Role[] = ["LPK_SENSEI"];
const LPK_BOTH: Role[] = ["LPK_ADMIN", "LPK_SENSEI"];
const TSK_BOTH: Role[] = ["TSK_ADMIN", "TSK_STAFF"];
const TSK_A: Role[] = ["TSK_ADMIN"];
const SUPER: Role[] = ["SUPER_ADMIN"];
const HALF_FULL: WidgetSize[] = ["half", "full"];

/**
 * KATALOG WIDGET: satu-satunya definisi widget dashboard. Urutan array = urutan bawaan (per peran, disaring dari sini). Dipakai
 * halaman dashboard, mode atur, dan validator layout tersimpan. Widget di luar katalog peran tidak pernah di-render atau di-query.
 */
export const WIDGETS: readonly WidgetDef[] = [
  // ---- KPI
  { id: "kpi-unrated", kind: "kpi", roles: LPK_BOTH, sizes: [], defaultSize: "half", label: "kpiUnrated", tone: "attention", icon: "assessments" },
  { id: "kpi-unshared", kind: "kpi", roles: LPK_A, sizes: [], defaultSize: "half", label: "kpiUnshared", tone: "attention", icon: "share" },
  { id: "kpi-passport", kind: "kpi", roles: LPK_A, sizes: [], defaultSize: "half", label: "kpiPassport", tone: "attention", icon: "residence" },
  { id: "kpi-incomplete", kind: "kpi", roles: LPK_A, sizes: [], defaultSize: "half", label: "kpiIncomplete", tone: "attention", icon: "records" },
  { id: "kpi-new-shared", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiNewShared", tone: "info", icon: "candidates" },
  { id: "kpi-awaiting", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiAwaiting", tone: "attention", icon: "clock" },
  { id: "kpi-open-jobs", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiOpenJobs", tone: "info", icon: "jobOrders" },
  { id: "kpi-placed", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiPlaced", tone: "info", icon: "clients" },
  { id: "kpi-records-unread", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiRecordsUnread", tone: "attention", icon: "records" },
  { id: "kpi-interviews-pending", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiInterviewsPending", tone: "attention", icon: "periodic" },
  { id: "kpi-followups-open", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiFollowupsOpen", tone: "attention", icon: "tasks" },
  // Penanggung jawab pekerja (T-010): hanya TSK_ADMIN
  // Kartu izin tinggal 在留カード (T-019): urgent/prepare/waiting untuk semua staf TSK (staf = pekerja yang ia 担当, Admin = semua), missing hanya Admin
  { id: "kpi-card-urgent", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiCardUrgent", tone: "attention", icon: "residence" },
  { id: "kpi-card-prepare", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiCardPrepare", tone: "info", icon: "residence" },
  { id: "kpi-card-waiting", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiCardWaiting", tone: "info", icon: "clock" },
  { id: "kpi-card-missing", kind: "kpi", roles: TSK_A, sizes: [], defaultSize: "half", label: "kpiCardMissing", tone: "attention", icon: "alert" },
  { id: "kpi-staff-over", kind: "kpi", roles: TSK_A, sizes: [], defaultSize: "half", label: "kpiStaffOver", tone: "attention", icon: "users" },
  { id: "kpi-unassigned", kind: "kpi", roles: TSK_A, sizes: [], defaultSize: "half", label: "kpiUnassigned", tone: "attention", icon: "alert" },
  { id: "kpi-orgs", kind: "kpi", roles: SUPER, sizes: [], defaultSize: "half", label: "kpiOrgs", tone: "neutral", icon: "organizations" },
  { id: "kpi-users", kind: "kpi", roles: SUPER, sizes: [], defaultSize: "half", label: "kpiUsers", tone: "neutral", icon: "users" },
  { id: "kpi-fields", kind: "kpi", roles: SUPER, sizes: [], defaultSize: "half", label: "kpiFields", tone: "neutral", icon: "skillFields" },
  // ---- Widget
  { id: "unrated-list", kind: "widget", roles: LPK_BOTH, sizes: HALF_FULL, defaultSize: "half", label: "wUnrated" },
  { id: "tsk-decisions", kind: "widget", roles: LPK_A, sizes: HALF_FULL, defaultSize: "half", label: "wDecisions" },
  { id: "stage-bar", kind: "widget", roles: LPK_A, sizes: HALF_FULL, defaultSize: "half", label: "wStages" },
  { id: "score-trend", kind: "widget", roles: LPK_A, sizes: HALF_FULL, defaultSize: "half", label: "wTrend" },
  { id: "my-assessments", kind: "widget", roles: LPK_S, sizes: HALF_FULL, defaultSize: "half", label: "wMine" },
  { id: "attention", kind: "widget", roles: LPK_S, sizes: HALF_FULL, defaultSize: "half", label: "wAttention" },
  { id: "pipeline", kind: "widget", roles: TSK_BOTH, sizes: HALF_FULL, defaultSize: "half", label: "wPipeline" },
  { id: "open-jobs", kind: "widget", roles: TSK_BOTH, sizes: HALF_FULL, defaultSize: "half", label: "wJobs" },
  { id: "new-candidates", kind: "widget", roles: TSK_BOTH, sizes: HALF_FULL, defaultSize: "half", label: "wNewCands" },
  { id: "activity", kind: "widget", roles: ["LPK_ADMIN", "TSK_ADMIN"], sizes: HALF_FULL, defaultSize: "full", label: "wActivity" },
  { id: "my-followups", kind: "widget", roles: TSK_BOTH, sizes: HALF_FULL, defaultSize: "half", label: "wMyFollowups" },
  { id: "open-cases", kind: "widget", roles: TSK_BOTH, sizes: HALF_FULL, defaultSize: "half", label: "wOpenCases" },
  { id: "org-list", kind: "widget", roles: SUPER, sizes: HALF_FULL, defaultSize: "full", label: "wOrgs" },
];

export const widgetsForRole = (role: Role) => WIDGETS.filter((w) => w.roles.includes(role));
export const widgetById = (id: string) => WIDGETS.find((w) => w.id === id);
