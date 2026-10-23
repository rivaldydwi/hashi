import assert from "node:assert/strict";
import { test } from "node:test";
import { KPI_GROUPS, MAX_PRIMARY_PER_ROLE, groupKpis, kpiLook } from "../../src/db/dashboard-kpi";
import { WIDGETS, isPrimaryKpi, kpiGroupOf, widgetsForRole } from "../../src/db/dashboard-catalog";
import { role as roleEnum } from "../../src/db/schema";

const ROLES = roleEnum.enumValues;
import { ICON_NAMES } from "../../src/components/shell/Icon";

const kpis = WIDGETS.filter((w) => w.kind === "kpi");

test("setiap KPI di katalog punya nada dan ikon yang ada; widget non-KPI tidak punya", () => {
  assert.ok(kpis.length >= 16);
  for (const k of kpis) {
    assert.ok(k.tone && ["neutral", "info", "attention"].includes(k.tone), `${k.id}: nada`);
    assert.ok(k.icon && ICON_NAMES.includes(k.icon), `${k.id}: ikon ${k.icon}`);
  }
  for (const w of WIDGETS.filter((x) => x.kind === "widget")) assert.ok(!w.tone && !w.icon && !w.group && !w.primaryFor, `${w.id}: widget tidak punya nada/ikon/kelompok`);
});

test("KPI 'perlu tindakan': 0 = tenang (calm), > 0 = perhatian; KPI informasi/netral tidak pernah berubah oleh nilainya", () => {
  assert.equal(kpiLook("attention", 0), "calm");
  assert.equal(kpiLook("attention", 1), "attention");
  assert.equal(kpiLook("attention", 250), "attention");
  for (const v of [0, 1, 99]) {
    assert.equal(kpiLook("info", v), "info");
    assert.equal(kpiLook("neutral", v), "neutral");
  }
});

test("pembagian nada mengikuti makna: KPI tindakan = attention; informasi = info; hitungan platform = neutral", () => {
  const tone = (id: string) => kpis.find((k) => k.id === id)?.tone;
  for (const id of ["kpi-unrated", "kpi-unshared", "kpi-passport", "kpi-incomplete", "kpi-awaiting", "kpi-records-unread", "kpi-interviews-pending", "kpi-followups-open", "kpi-staff-over", "kpi-unassigned"]) assert.equal(tone(id), "attention", id);
  for (const id of ["kpi-new-shared", "kpi-open-jobs", "kpi-placed"]) assert.equal(tone(id), "info", id);
  for (const id of ["kpi-orgs", "kpi-users", "kpi-fields"]) assert.equal(tone(id), "neutral", id);
});

// ---- T-035: kelompok alur kerja dan KPI utama

test("setiap KPI punya kelompok yang dikenal; KPI utama hanya untuk peran yang memang melihat KPI itu", () => {
  for (const k of kpis) {
    assert.ok(k.group && (KPI_GROUPS as readonly string[]).includes(k.group), `${k.id}: kelompok ${k.group}`);
    for (const r of k.primaryFor ?? []) assert.ok(k.roles.includes(r), `${k.id}: utama untuk ${r} tetapi peran itu tidak melihatnya`);
  }
});

test("KPI utama per peran: 1 sampai MAX_PRIMARY_PER_ROLE untuk peran yang punya KPI tindakan, tidak lebih", () => {
  for (const role of ROLES) {
    const roleKpis = widgetsForRole(role).filter((w) => w.kind === "kpi");
    const primary = roleKpis.filter((w) => isPrimaryKpi(w.id, role));
    assert.ok(primary.length <= MAX_PRIMARY_PER_ROLE, `${role}: ${primary.length} KPI utama`);
    if (roleKpis.some((w) => w.tone === "attention")) assert.ok(primary.length >= 1, `${role}: tidak ada KPI utama`);
  }
});

test("groupKpis: urutan kelompok tetap, urutan di dalam kelompok = urutan layout pengguna, kelompok kosong dibuang", () => {
  const items = [{ id: "kpi-card-urgent" }, { id: "kpi-records-unread" }, { id: "kpi-placed" }, { id: "kpi-awaiting" }, { id: "kpi-new-shared" }];
  const out = groupKpis(items, kpiGroupOf);
  assert.deepEqual(out.map((g) => g.group), ["selection", "workers", "records"]);
  assert.deepEqual(out.map((g) => g.items.map((x) => x.id)), [["kpi-awaiting", "kpi-new-shared"], ["kpi-card-urgent", "kpi-placed"], ["kpi-records-unread"]]);
  assert.deepEqual(groupKpis([], kpiGroupOf), []);
  assert.equal(kpiGroupOf("tidak-ada"), "system");
});

test("setiap peran: semua KPI-nya masuk tepat satu kelompok (tidak ada kartu yang hilang saat dikelompokkan)", () => {
  for (const role of ROLES) {
    const ids = widgetsForRole(role).filter((w) => w.kind === "kpi").map((w) => ({ id: w.id }));
    assert.equal(groupKpis(ids, kpiGroupOf).flatMap((g) => g.items).length, ids.length, role);
  }
});
