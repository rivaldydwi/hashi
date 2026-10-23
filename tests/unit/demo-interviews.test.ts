import assert from "node:assert/strict";
import { test } from "node:test";
import { planDemoInterviews, type DemoInterviewPlan } from "../../src/db/demo-interviews";
import { fiscalQuarterRange, fiscalYearOf, monthMark, quarterOfMonth, quarterState, type QuarterInterview, type WorkSpan } from "../../src/db/records-core";
import { addDays } from "../../src/db/demo-rng";

// T-037: rencana wawancara berkala demo memenuhi syarat `verify:seed` dan e2e (records-views, interview-quarters) untuk SETIAP hari FY2026 dan FY2027,
// memakai fungsi kuartal yang SAMA dengan grid aplikasi (quarterState/monthMark). Inilah jaminan untuk tanggal mendatang (database tidak bisa diuji di masa depan).

const QUARTERS = [1, 2, 3, 4] as const;

function view(plan: DemoInterviewPlan) {
  const spans: Record<string, WorkSpan[]> = {
    w0: [{ start: plan.starts[0], end: null }],
    w1: [{ start: plan.starts[1], end: null }],
    w2: [{ start: plan.starts[2], end: null }],
    ended: [{ start: plan.ended.start, end: plan.ended.end }],
  };
  const interviews: Record<string, QuarterInterview[]> = { w0: [], w1: [], w2: [], ended: [{ applicable: true, resultStatus: "no_issue", date: plan.ended.interviewDate }] };
  for (const r of plan.rows) interviews[`w${r.worker}`].push({ applicable: r.applicable, resultStatus: r.status, date: r.date ?? r.month });
  return { spans, interviews };
}
const statesIn = (fy: number, today: string, v: ReturnType<typeof view>, who: string) => QUARTERS.map((q) => quarterState(fy, q, v.interviews[who], today, v.spans[who]));

function check(today: string) {
  const plan = planDemoInterviews(today);
  const v = view(plan);
  const fy = fiscalYearOf(today);
  const curQ = quarterOfMonth(`${today.slice(0, 7)}-01`);
  const where = `today=${today}`;

  // tanggal masuk akal: mulai sebelum hari ini, wawancara antara mulai dan hari ini, bulan tidak sebelum bulan mulai
  for (const [w, s] of plan.starts.entries()) assert.ok(s < today, `${where}: w${w} mulai ${s}`);
  for (const r of plan.rows) {
    if (r.date) assert.ok(r.date >= plan.starts[r.worker] && r.date <= today, `${where}: w${r.worker} ${r.date}`);
    assert.ok(r.month >= `${plan.starts[r.worker].slice(0, 7)}-01` && r.month <= `${today.slice(0, 7)}-01`, `${where}: bulan ${r.month}`);
  }
  assert.ok(plan.ended.start < plan.ended.interviewDate && plan.ended.interviewDate <= plan.ended.end && plan.ended.end < today, `${where}: pekerja berhenti`);

  // syarat verify:seed "Wawancara berkala" (baris aktif + pekerja berhenti)
  const all = [...plan.rows.map((r) => r.status), "no_issue"];
  for (const w of [0, 1, 2] as const) assert.ok(plan.rows.some((r) => r.worker === w), `${where}: w${w} tanpa wawancara`);
  for (const s of ["no_issue", "follow_up", "issue", "not_done"]) assert.ok(all.includes(s as never), `${where}: status ${s}`);
  assert.ok(all.filter((s) => s === "no_issue").length > all.length / 2 - 1, `${where}: 問題なし dominan`);
  for (const x of ["agency", "support", "worker"]) assert.ok(plan.rows.some((r) => r.reason === x), `${where}: alasan ${x}`);
  assert.ok(plan.rows.some((r) => !r.applicable), `${where}: 対象外`);
  assert.ok(plan.quarterNotes.some((n) => n.quarter === 1), `${where}: catatan Q1`);
  // syarat verify:seed "Form 5-5"
  assert.ok(plan.rows.some((r) => r.form && r.status === "issue"), `${where}: 基準不適合 berform`);
  for (const m of ["in_person", "online"]) assert.ok(plan.rows.some((r) => r.method === m), `${where}: cara ${m}`);
  for (const r of plan.rows) if (r.form) assert.ok(r.applicable && r.status !== "not_done", `${where}: form pada yang tidak dilaksanakan`);

  // FY berjalan (halaman grid bawaan): kuartal berjalan open (KPI > 0) dan ada yang selesai
  const now = ["w0", "w1", "w2"].flatMap((w) => statesIn(fy, today, v, w));
  assert.ok(["w0", "w1", "w2"].some((w) => statesIn(fy, today, v, w)[curQ - 1] === "open"), `${where}: kuartal berjalan open`);
  assert.ok(now.includes("done"), `${where}: done di FY berjalan`);
  // showcaseFy: missed + bulan 対象外 + done (e2e records-views; di Q1 = FY lalu)
  const sf = plan.showcaseFy;
  assert.equal(sf, curQ === 1 ? fy - 1 : fy, `${where}: showcaseFy`);
  const show = ["w0", "w1", "w2", "ended"].flatMap((w) => statesIn(sf, today, v, w));
  assert.ok(show.includes("missed"), `${where}: missed di FY ${sf}`);
  assert.ok(show.includes("done"), `${where}: done di FY ${sf}`);
  const naRow = plan.rows.find((r) => !r.applicable)!;
  assert.equal(fiscalYearOf(naRow.month), sf, `${where}: 対象外 di FY ${sf}`);
  assert.equal(monthMark(naRow.month, { applicable: false, resultStatus: null, interviewDate: null }, today, v.spans.w0), "na");
  // pekerja berhenti: FY-nya memuat done DAN missed; FY sesudahnya tidak memuatnya
  const efy = fiscalYearOf(plan.ended.end);
  const es = statesIn(efy, today, v, "ended");
  assert.ok(es.includes("done") && es.includes("missed"), `${where}: berhenti FY ${efy} ${es}`);
  assert.ok(statesIn(efy + 1, today, v, "ended").every((s) => s === "notRequired"), `${where}: berhenti muncul di FY ${efy + 1}`);
  assert.ok(plan.ended.end < fiscalQuarterRange(efy + 1, 1).start);
}

test("rencana wawancara demo memenuhi syarat verify:seed dan e2e untuk setiap hari 1 Apr 2026 - 31 Mar 2028", () => {
  let n = 0;
  for (let d = "2026-04-01"; d <= "2028-03-31"; d = addDays(d, 1)) {
    check(d);
    n++;
  }
  assert.equal(n, 731);
});

test("deterministik: tanggal sama = rencana sama", () => {
  assert.deepEqual(planDemoInterviews("2026-10-23"), planDemoInterviews("2026-10-23"));
});
