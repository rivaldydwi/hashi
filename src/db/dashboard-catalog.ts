import type { Role } from "./schema";

export type WidgetSize = "half" | "full";
export type WidgetDef = {
  id: string;
  /** kpi = kartu angka (selalu 3 kolom, hanya bisa disembunyikan); widget = 6 kolom (setengah) atau 12 kolom (penuh). */
  kind: "kpi" | "widget";
  roles: readonly Role[];
  /** Ukuran yang diizinkan (kosong untuk KPI). */
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** Kunci pesan label (namespace dashboard), dipakai mode atur. */
  label: string;
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
  { id: "kpi-unrated", kind: "kpi", roles: LPK_BOTH, sizes: [], defaultSize: "half", label: "kpiUnrated" },
  { id: "kpi-unshared", kind: "kpi", roles: LPK_A, sizes: [], defaultSize: "half", label: "kpiUnshared" },
  { id: "kpi-passport", kind: "kpi", roles: LPK_A, sizes: [], defaultSize: "half", label: "kpiPassport" },
  { id: "kpi-incomplete", kind: "kpi", roles: LPK_A, sizes: [], defaultSize: "half", label: "kpiIncomplete" },
  { id: "kpi-new-shared", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiNewShared" },
  { id: "kpi-awaiting", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiAwaiting" },
  { id: "kpi-open-jobs", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiOpenJobs" },
  { id: "kpi-placed", kind: "kpi", roles: TSK_BOTH, sizes: [], defaultSize: "half", label: "kpiPlaced" },
  { id: "kpi-orgs", kind: "kpi", roles: SUPER, sizes: [], defaultSize: "half", label: "kpiOrgs" },
  { id: "kpi-users", kind: "kpi", roles: SUPER, sizes: [], defaultSize: "half", label: "kpiUsers" },
  { id: "kpi-fields", kind: "kpi", roles: SUPER, sizes: [], defaultSize: "half", label: "kpiFields" },
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
  { id: "coming-soon", kind: "widget", roles: TSK_BOTH, sizes: HALF_FULL, defaultSize: "half", label: "wSoon" },
  { id: "org-list", kind: "widget", roles: SUPER, sizes: HALF_FULL, defaultSize: "full", label: "wOrgs" },
];

export const widgetsForRole = (role: Role) => WIDGETS.filter((w) => w.roles.includes(role));
export const widgetById = (id: string) => WIDGETS.find((w) => w.id === id);
