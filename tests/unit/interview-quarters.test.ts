import assert from "node:assert/strict";
import { test } from "node:test";
import { QUARTER_URGENT_DAYS, daysToQuarterDeadline, fiscalQuarterRange, monthMark, quarterOfDate, quarterState, quarterUrgent, workedInFiscalYear, workedInQuarter, type QuarterInterview, type WorkSpan } from "../../src/db/records-core";

const done = (date: string): QuarterInterview => ({ applicable: true, resultStatus: "no_issue", date });
const span = (start: string, end: string | null = null): WorkSpan[] => [{ start, end }];

test("rentang kuartal tahun fiskal: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Okt-Des, Q4 Jan-Mar (tahun berikutnya); akhir bulan benar (termasuk Februari tahun kabisat)", () => {
  assert.deepEqual(fiscalQuarterRange(2026, 1), { start: "2026-04-01", end: "2026-06-30" });
  assert.deepEqual(fiscalQuarterRange(2026, 2), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(fiscalQuarterRange(2026, 3), { start: "2026-10-01", end: "2026-12-31" });
  assert.deepEqual(fiscalQuarterRange(2026, 4), { start: "2027-01-01", end: "2027-03-31" });
  assert.deepEqual(quarterOfDate("2027-02-10"), { fy: 2026, q: 4 });
  assert.deepEqual(quarterOfDate("2026-04-01"), { fy: 2026, q: 1 });
  assert.deepEqual(quarterOfDate("2026-03-31"), { fy: 2025, q: 4 });
});

test("mulai di tengah kuartal: kuartal itu sudah wajib (bekerja minimal satu hari); kuartal sebelumnya tidak", () => {
  const w = span("2026-05-20");
  assert.equal(workedInQuarter(w, 2026, 1), true);
  assert.equal(workedInQuarter(w, 2025, 4), false);
  assert.equal(quarterState(2026, 1, [], "2026-10-05", w), "missed"); // Q1 sudah lewat tanpa wawancara
  assert.equal(quarterState(2025, 4, [], "2026-10-05", w), "notRequired");
  assert.equal(quarterState(2026, 1, [done("2026-06-10")], "2026-10-05", w), "done");
});

test("mulai Februari: hanya Q4 tahun fiskal sebelumnya yang wajib di FY itu; FY berikutnya mulai Q1", () => {
  const w = span("2026-02-10");
  assert.equal(workedInFiscalYear(w, 2025), true, "masuk laporan FY2025");
  assert.deepEqual([1, 2, 3, 4].map((q) => quarterState(2025, q as 1 | 2 | 3 | 4, [], "2026-10-05", w)), ["notRequired", "notRequired", "notRequired", "missed"]);
  assert.equal(quarterState(2026, 1, [], "2026-10-05", w), "missed");
  assert.equal(workedInQuarter(w, 2026, 4), true, "masih bekerja (tanpa tanggal berhenti)");
});

test("berhenti di tengah kuartal: kuartal berhenti tetap wajib, kuartal sesudahnya tidak; tetap masuk laporan tahun fiskalnya (mulai Mei 2026, berhenti Jan 2027 -> FY2026)", () => {
  const w = span("2026-05-01", "2027-01-15");
  assert.equal(workedInFiscalYear(w, 2026), true);
  assert.equal(workedInFiscalYear(w, 2027), false, "tidak muncul di FY sesudah berhenti");
  assert.equal(workedInQuarter(w, 2026, 4), true, "berhenti 15 Jan: Q4 FY2026 masih ada satu hari+ kerja");
  assert.equal(workedInQuarter(span("2026-05-01", "2026-12-31"), 2026, 4), false, "berhenti 31 Des: Q4 tidak wajib");
  assert.equal(workedInQuarter(span("2026-05-01", "2027-01-01"), 2026, 4), true, "berhenti tepat 1 Jan = hari kerja terakhir di Q4 (inklusif)");
  assert.equal(quarterState(2026, 3, [], "2027-02-01", span("2026-05-01", "2026-12-31")), "missed");
});

test("kuartal depan tidak ditagih; kuartal BERJALAN tanpa wawancara = open (bukan merah) dari hari pertama sampai hari terakhir; sehari setelah berakhir = missed; dengan wawancara = Selesai", () => {
  const w = span("2025-06-01");
  assert.equal(quarterState(2026, 3, [], "2026-09-30", w), "notDue", "Q3 baru mulai 1 Okt");
  assert.equal(quarterState(2026, 3, [], "2026-10-01", w), "open", "hari pertama Q3 tanpa wawancara = open");
  assert.equal(quarterState(2026, 3, [], "2026-12-31", w), "open", "hari terakhir Q3 masih open (tenggat = akhir kuartal)");
  assert.equal(quarterState(2026, 3, [], "2027-01-01", w), "missed", "sehari setelah Q3 berakhir = missed");
  assert.equal(quarterState(2026, 3, [done("2026-12-31")], "2027-01-05", w), "done", "wawancara di hari terakhir kuartal menyelamatkan kuartal");
  assert.equal(quarterState(2026, 3, [done("2026-10-03")], "2026-10-05", w), "done");
  assert.equal(quarterState(2026, 4, [], "2026-10-05", w), "notDue");
});

test("wawancara lebih dari satu per kuartal tidak masalah; yang berstatus 未実施 tidak dihitung; wawancara kuartal lain tidak menolong", () => {
  const w = span("2025-06-01");
  assert.equal(quarterState(2026, 2, [done("2026-07-05"), done("2026-08-10"), done("2026-09-12")], "2026-10-05", w), "done");
  assert.equal(quarterState(2026, 2, [{ applicable: true, resultStatus: "not_done", date: "2026-08-01" }], "2026-10-05", w), "missed");
  assert.equal(quarterState(2026, 2, [done("2026-06-30"), done("2026-10-01")], "2026-10-05", w), "missed", "batas kuartal: 30 Jun (Q1) dan 1 Okt (Q3) bukan Q2");
  assert.equal(quarterState(2026, 2, [done("2026-07-01")], "2026-10-05", w), "done", "hari pertama kuartal");
  assert.equal(quarterState(2026, 2, [done("2026-09-30")], "2026-10-05", w), "done", "hari terakhir kuartal");
});

test("対象外 (tidak berlaku): tidak ditagih bila tidak ada wawancara selesai; wawancara selesai di kuartal yang sama menang", () => {
  const w = span("2025-06-01");
  const na: QuarterInterview = { applicable: false, resultStatus: null, date: "2026-08-01" };
  assert.equal(quarterState(2026, 2, [na], "2026-10-05", w), "na");
  assert.equal(quarterState(2026, 2, [na, done("2026-09-01")], "2026-10-05", w), "done");
});

test("pindah tahun fiskal & beberapa penempatan (berhenti lalu bekerja lagi): hanya masa bekerja yang wajib", () => {
  const spans: WorkSpan[] = [{ start: "2026-01-10", end: "2026-05-31" }, { start: "2026-10-01", end: null }];
  assert.equal(workedInQuarter(spans, 2025, 4), true);
  assert.equal(workedInQuarter(spans, 2026, 1), true, "Apr-Mei bekerja");
  assert.equal(workedInQuarter(spans, 2026, 2), false, "Jul-Sep jeda");
  assert.equal(workedInQuarter(spans, 2026, 3), true);
  assert.equal(quarterState(2026, 2, [], "2026-10-05", spans), "notRequired");
});

test("tanda bulan di grid: bulan tanpa wawancara bukan tanda merah (none); di luar masa kerja atau bulan depan = notDue; 対象外 = na", () => {
  const w = span("2026-05-20", "2026-08-20");
  const today = "2026-10-05";
  const row = (r: string | null, applicable = true) => ({ applicable, resultStatus: r, interviewDate: null });
  assert.equal(monthMark("2026-04-01", undefined, today, w), "notDue", "sebelum mulai kerja");
  assert.equal(monthMark("2026-05-01", undefined, today, w), "none", "bulan mulai kerja");
  assert.equal(monthMark("2026-06-01", row("no_issue"), today, w), "done");
  assert.equal(monthMark("2026-08-01", undefined, today, w), "none", "bulan berhenti masih bulan kerja");
  assert.equal(monthMark("2026-09-01", undefined, today, w), "notDue", "sesudah berhenti tidak ditagih");
  assert.equal(monthMark("2026-07-01", row(null, false), today, w), "na");
  assert.equal(monthMark("2026-11-01", undefined, today, span("2025-01-01")), "notDue", "bulan depan");
  assert.equal(monthMark("2026-10-01", undefined, today, span("2025-01-01")), "none", "bulan berjalan belum ada wawancara");
});

test("14 hari terakhir kuartal berjalan = mendesak (kuning); konstanta tunggal QUARTER_URGENT_DAYS", () => {
  assert.equal(QUARTER_URGENT_DAYS, 14);
  assert.equal(daysToQuarterDeadline(2026, 3, "2026-12-31"), 0);
  assert.equal(daysToQuarterDeadline(2026, 3, "2026-12-17"), 14);
  assert.equal(daysToQuarterDeadline(2026, 3, "2027-01-02"), -2);
  assert.equal(quarterUrgent(2026, 3, "2026-12-17"), false, "tersisa 14 hari: belum");
  assert.equal(quarterUrgent(2026, 3, "2026-12-18"), true, "tersisa 13 hari: 14 hari terakhir dimulai");
  assert.equal(quarterUrgent(2026, 3, "2026-12-31"), true, "hari terakhir");
  assert.equal(quarterUrgent(2026, 3, "2026-10-01"), false, "awal kuartal");
  assert.equal(daysToQuarterDeadline(2025, 4, "2026-03-01"), 30);
});
