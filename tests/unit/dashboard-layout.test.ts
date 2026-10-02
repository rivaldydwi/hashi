import test from "node:test";
import assert from "node:assert/strict";
import { defaultLayout, LayoutError, parseLayoutInput, resolveLayout, toStored } from "../../src/db/dashboard-layout";
import { widgetsForRole, WIDGETS } from "../../src/db/dashboard-catalog";

const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

test("katalog: id unik; tiap peran punya widget; KPI tanpa ukuran, widget punya ukuran bawaan yang diizinkan", () => {
  assert.equal(new Set(WIDGETS.map((w) => w.id)).size, WIDGETS.length);
  for (const role of ["LPK_ADMIN", "LPK_SENSEI", "TSK_ADMIN", "TSK_STAFF", "SUPER_ADMIN"] as const) assert.ok(widgetsForRole(role).length > 0, role);
  for (const w of WIDGETS) {
    if (w.kind === "kpi") assert.equal(w.sizes.length, 0);
    else assert.ok(w.sizes.includes(w.defaultSize), w.id);
  }
});

test("sensei tidak mendapat widget sensitif milik admin", () => {
  const sensei = ids(widgetsForRole("LPK_SENSEI"));
  for (const id of ["kpi-unshared", "kpi-passport", "kpi-incomplete", "tsk-decisions", "stage-bar", "score-trend"]) assert.ok(!sensei.includes(id), id);
});

test("tanpa data tersimpan (null/rusak): susunan bawaan", () => {
  const base = defaultLayout("LPK_ADMIN");
  assert.deepEqual(resolveLayout("LPK_ADMIN", null), base);
  assert.deepEqual(resolveLayout("LPK_ADMIN", "ngawur"), base);
  assert.deepEqual(resolveLayout("LPK_ADMIN", { v: 2, items: [] }), base);
  assert.deepEqual(resolveLayout("LPK_ADMIN", { v: 1, items: "x" }), base);
});

test("resolve: urutan tersimpan dipakai, id asing/duplikat dibuang, widget yang belum tercantum ditambahkan di akhir", () => {
  const r = resolveLayout("LPK_ADMIN", { v: 1, items: [{ id: "stage-bar", size: "full" }, { id: "tsk-decisions", hidden: true }, { id: "tidak-ada" }, { id: "stage-bar" }, { id: "kpi-passport" }, { id: "kpi-new-shared" }] });
  assert.deepEqual(ids(r).slice(0, 3), ["stage-bar", "tsk-decisions", "kpi-passport"]);
  assert.equal(r.length, widgetsForRole("LPK_ADMIN").length);
  assert.equal(new Set(ids(r)).size, r.length);
  assert.equal(r.find((x) => x.id === "stage-bar")!.size, "full");
  assert.equal(r.find((x) => x.id === "tsk-decisions")!.hidden, true);
  assert.ok(!ids(r).includes("kpi-new-shared")); // widget peran lain tidak ikut walau tersimpan
});

test("resolve: ukuran tak berlaku untuk KPI; ukuran asing kembali ke bawaan", () => {
  const r = resolveLayout("LPK_ADMIN", { v: 1, items: [{ id: "kpi-unrated", size: "full" }, { id: "stage-bar", size: "full" }] });
  assert.equal(r.find((x) => x.id === "kpi-unrated")!.size, "half");
});

test("parse masukan: valid lolos dan dinormalkan; id asing, duplikat, ukuran tak sah, bentuk salah ditolak", () => {
  const ok = parseLayoutInput("TSK_STAFF", { v: 1, items: [{ id: "pipeline", size: "full" }, { id: "kpi-placed", hidden: true }] });
  assert.deepEqual(ok, { v: 1, items: [{ id: "pipeline", size: "full" }, { id: "kpi-placed", hidden: true }] });
  assert.throws(() => parseLayoutInput("TSK_STAFF", { v: 1, items: [{ id: "kpi-passport" }] }), LayoutError); // widget LPK
  assert.throws(() => parseLayoutInput("TSK_STAFF", { v: 1, items: [{ id: "pipeline" }, { id: "pipeline" }] }), LayoutError);
  assert.throws(() => parseLayoutInput("TSK_STAFF", { v: 1, items: [{ id: "pipeline", size: "besar" }] }), LayoutError);
  assert.throws(() => parseLayoutInput("TSK_STAFF", { v: 1, items: [{ id: "pipeline", ekstra: 1 }] }), LayoutError);
  assert.throws(() => parseLayoutInput("TSK_STAFF", null), LayoutError);
  assert.throws(() => parseLayoutInput("TSK_STAFF", { v: 1, items: Array.from({ length: 41 }, () => ({ id: "pipeline" })) }), LayoutError);
});

test("toStored lalu resolve = susunan semula", () => {
  const r = defaultLayout("SUPER_ADMIN").reverse().map((x, i) => ({ ...x, hidden: i === 1 }));
  assert.deepEqual(resolveLayout("SUPER_ADMIN", toStored(r)).map((x) => [x.id, x.hidden]), r.map((x) => [x.id, x.hidden]));
});
