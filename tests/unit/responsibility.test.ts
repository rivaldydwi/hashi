import assert from "node:assert/strict";
import { test } from "node:test";
import { currentAssignment, effectiveResponsible, unassignedWorkers, workloadByStaff, workloadLevel, type AssignmentRow } from "../../src/db/responsibility";
import { WORKLOAD } from "../../src/db/workload-config";

const row = (staffId: string | null, effectiveFrom: string, createdAt = `${effectiveFrom}T00:00:00Z`): AssignmentRow => ({ staffId, effectiveFrom, createdAt });
const TODAY = "2026-10-06";

test("konfigurasi batas: satu konstanta (50, peringatan 45, berlaku 2027-04-01)", () => {
  assert.deepEqual({ ...WORKLOAD }, { max: 50, warnAt: 45, effectiveFrom: "2027-04-01" });
});

test("penetapan yang berlaku: terbaru dengan tanggal mulai <= hari ini; yang akan datang belum berlaku; seri pada tanggal sama = yang dibuat terakhir", () => {
  assert.equal(currentAssignment([], TODAY), null);
  assert.equal(currentAssignment([row("A", "2026-11-01")], TODAY), null, "baru berlaku bulan depan");
  assert.equal(currentAssignment([row("A", "2026-04-01"), row("B", "2026-09-01")], TODAY)?.staffId, "B");
  assert.equal(currentAssignment([row("A", "2026-04-01"), row("B", "2026-09-01"), row("C", "2026-12-01")], TODAY)?.staffId, "B", "yang terjadwal ke depan diabaikan");
  assert.equal(currentAssignment([row("A", "2026-09-01", "2026-09-01T01:00:00Z"), row("B", "2026-09-01", "2026-09-01T09:00:00Z")], TODAY)?.staffId, "B", "tanggal sama: yang paling akhir dibuat");
  assert.equal(currentAssignment([row("B", "2026-10-06")], TODAY)?.staffId, "B", "berlaku hari ini (inklusif)");
});

test("penanggung jawab efektif: per pekerja menimpa perusahaan; dikosongkan = ikut perusahaan; keduanya kosong = tidak ada", () => {
  const company = [row("Cia", "2026-04-01")];
  assert.deepEqual(effectiveResponsible([], company, TODAY), { staffId: "Cia", source: "company" });
  assert.deepEqual(effectiveResponsible([row("Pak", "2026-08-01")], company, TODAY), { staffId: "Pak", source: "placement" }, "pilihan per pekerja menimpa perusahaan");
  assert.deepEqual(effectiveResponsible([row("Pak", "2026-08-01"), row(null, "2026-09-15")], company, TODAY), { staffId: "Cia", source: "company" }, "override dikosongkan: kembali ke perusahaan");
  assert.deepEqual(effectiveResponsible([], [], TODAY), { staffId: null, source: "none" });
  assert.deepEqual(effectiveResponsible([], [row("Cia", "2026-04-01"), row(null, "2026-09-01")], TODAY), { staffId: null, source: "none" }, "perusahaan dikosongkan");
  assert.deepEqual(effectiveResponsible([row("Pak", "2026-12-01")], company, TODAY), { staffId: "Cia", source: "company" }, "override terjadwal ke depan belum berlaku");
  assert.deepEqual(effectiveResponsible([], [row("Cia", "2026-04-01"), row("Dua", "2026-10-06")], TODAY), { staffId: "Dua", source: "company" }, "penggantian perusahaan yang berlaku hari ini");
});

test("tingkat beban: < 45 ok, 45..50 kuning (50 = batas tercapai), > 50 merah", () => {
  assert.equal(workloadLevel(0), "ok");
  assert.equal(workloadLevel(44), "ok");
  assert.equal(workloadLevel(45), "warn");
  assert.equal(workloadLevel(50), "warn");
  assert.equal(workloadLevel(51), "over");
});

test("beban per staf: hanya penempatan ACTIVE dihitung (ENDED tidak), total lintas klien per orang; staf tanpa pekerja tetap muncul dengan 0; ganti per pekerja memindahkan hitungan", () => {
  const mk = (n: number, responsibleId: string | null, status: "ACTIVE" | "ENDED" = "ACTIVE") => Array.from({ length: n }, () => ({ status, responsibleId }));
  // contoh dari staf TSK: 30 di klien A + 20 di klien B = 50 (batas tercapai); ENDED tidak dihitung
  const workers = [...mk(30, "S1"), ...mk(20, "S1"), ...mk(5, "S1", "ENDED"), ...mk(3, "S2"), ...mk(4, null)];
  const w = workloadByStaff(workers, ["S1", "S2", "S3"]);
  assert.deepEqual(w.map((x) => [x.staffId, x.count, x.level]), [["S1", 50, "warn"], ["S2", 3, "ok"], ["S3", 0, "ok"]]);
  assert.equal(unassignedWorkers(workers).length, 4, "pekerja aktif tanpa penanggung jawab; ENDED tidak termasuk");
  // satu pekerja S1 dipindah ke S2: S1 49, S2 4
  const moved = workers.map((x, i) => (i === 0 ? { ...x, responsibleId: "S2" } : x));
  assert.deepEqual(workloadByStaff(moved, ["S1", "S2"]).map((x) => [x.staffId, x.count]), [["S1", 49], ["S2", 4]]);
  // satu lagi pekerja ke S1 -> 51 = merah
  assert.equal(workloadByStaff([...workers, ...mk(1, "S1")], ["S1"])[0].level, "over");
  // pekerja ENDED dengan penanggung jawab tidak mengubah beban
  assert.equal(workloadByStaff(mk(60, "S1", "ENDED"), ["S1"])[0].count, 0);
});
