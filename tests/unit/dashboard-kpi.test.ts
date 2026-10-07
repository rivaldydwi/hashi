import assert from "node:assert/strict";
import { test } from "node:test";
import { kpiLook } from "../../src/db/dashboard-kpi";
import { WIDGETS } from "../../src/db/dashboard-catalog";
import { ICON_NAMES } from "../../src/components/shell/Icon";

const kpis = WIDGETS.filter((w) => w.kind === "kpi");

test("setiap KPI di katalog punya nada dan ikon yang ada; widget non-KPI tidak punya", () => {
  assert.ok(kpis.length >= 16);
  for (const k of kpis) {
    assert.ok(k.tone && ["neutral", "info", "attention"].includes(k.tone), `${k.id}: nada`);
    assert.ok(k.icon && ICON_NAMES.includes(k.icon), `${k.id}: ikon ${k.icon}`);
  }
  for (const w of WIDGETS.filter((x) => x.kind === "widget")) assert.ok(!w.tone && !w.icon, `${w.id}: widget tidak punya nada/ikon`);
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
