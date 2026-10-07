import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTENTION_STAGES, PERIOD_OPTIONS, RENEWAL_STATUSES, STAGE_URGENCY, addDays, addMonths, cardRecipients, cardStage, currentCard, daysBetween, isAttentionStage, isPeriodOption,
  type CardStage, type RenewalStatus,
} from "../../src/db/zairyu";

const st = (expiryDate: string, today: string, renewalStatus: RenewalStatus = "not_started", receivedOn: string | null = null) => cardStage({ expiryDate, renewalStatus, receivedOn, today });
const ymdIn = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));

test("tanggal: addMonths memakai hari terakhir bulan bila harinya tidak ada, juga mundur dan lintas tahun; addDays/daysBetween", () => {
  assert.equal(addMonths("2027-05-31", -3), "2027-02-28");
  assert.equal(addMonths("2027-03-31", -4), "2026-11-30");
  assert.equal(addMonths("2027-03-31", -3), "2026-12-31");
  assert.equal(addMonths("2028-02-29", -4), "2027-10-29");
  assert.equal(addMonths("2028-03-31", -1), "2028-02-29"); // tahun kabisat
  assert.equal(addMonths("2027-03-31", -1), "2027-02-28");
  assert.equal(addMonths("2027-01-31", -2), "2026-11-30");
  assert.equal(addMonths("2026-12-31", 2), "2027-02-28");
  assert.equal(addMonths("2027-08-31", 2), "2027-10-31");
  assert.equal(addMonths("2026-09-30", 2), "2026-11-30");
  assert.equal(addMonths("2026-10-15", 12), "2027-10-15");
  assert.equal(addDays("2027-05-31", -30), "2027-05-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-10-06", "2026-10-14"), 8);
  assert.equal(daysBetween("2026-10-14", "2026-10-06"), -8);
  assert.throws(() => addMonths("2026-13-01x", 1));
});

test("kasus 1: sudah lewat saat data dimasukkan = expired (daysLeft −6); tidak ada tahap yang 'dikejar'", () => {
  assert.deepEqual(st("2026-09-30", "2026-10-06"), { stage: "expired", daysLeft: -6, additionalDocs: false, specialUntil: null });
});

test("kasus 2: pertama kali dimasukkan sudah dekat = langsung h14 (daysLeft 8)", () => {
  const r = st("2026-10-14", "2026-10-06");
  assert.equal(r.stage, "h14");
  assert.equal(r.daysLeft, 8);
});

test("kasus 3: kartu baru diterima sebelum habis = done (berhenti), juga lewat receivedOn saja (pertahanan berlapis)", () => {
  assert.equal(st("2027-03-31", "2027-03-01", "received", "2027-02-10").stage, "done");
  assert.equal(st("2027-03-31", "2027-03-01", "preparing", "2027-02-10").stage, "done");
  assert.equal(st("2026-09-30", "2026-12-31", "received", "2026-12-20").stage, "done"); // diterima sesudah lewat 特例期間 pun selesai
});

test("kasus 4: hari terakhir masih berlaku (h7, daysLeft 0); sehari sesudahnya expired", () => {
  assert.deepEqual([st("2026-10-14", "2026-10-14").stage, st("2026-10-14", "2026-10-14").daysLeft], ["h7", 0]);
  assert.deepEqual([st("2026-10-14", "2026-10-15").stage, st("2026-10-14", "2026-10-15").daysLeft], ["expired", -1]);
});

test("kasus 5: batas H-30 / H-14 / H-7 inklusif (habis 2027-05-31)", () => {
  const at = (d: string) => st("2027-05-31", d).stage;
  assert.equal(at("2027-04-30"), "can_apply"); // 31 hari
  assert.equal(at("2027-05-01"), "h30"); // 30 hari
  assert.equal(at("2027-05-16"), "h30"); // 15 hari
  assert.equal(at("2027-05-17"), "h14"); // 14 hari
  assert.equal(at("2027-05-23"), "h14"); // 8 hari
  assert.equal(at("2027-05-24"), "h7"); // 7 hari
  assert.equal(at("2027-05-31"), "h7");
});

test("kasus 6: akhir bulan, 3 bulan: can_apply mulai 2027-02-28, prepare mulai 2027-01-31 (habis 2027-05-31)", () => {
  const at = (d: string) => st("2027-05-31", d).stage;
  assert.equal(at("2027-01-30"), "none");
  assert.equal(at("2027-01-31"), "prepare");
  assert.equal(at("2027-02-27"), "prepare");
  assert.equal(at("2027-02-28"), "can_apply");
});

test("kasus 7: akhir bulan hari ke-31: prepare mulai 2026-11-30 (bukan 12-01), can_apply mulai 2026-12-31 (habis 2027-03-31)", () => {
  const at = (d: string) => st("2027-03-31", d).stage;
  assert.equal(at("2026-11-29"), "none");
  assert.equal(at("2026-11-30"), "prepare");
  assert.equal(at("2026-12-30"), "prepare");
  assert.equal(at("2026-12-31"), "can_apply");
});

test("kasus 8: Februari kabisat (habis 2028-02-29): prepare 2027-10-29, can_apply 2027-11-29, h30 2028-01-30", () => {
  const at = (d: string) => st("2028-02-29", d).stage;
  assert.equal(at("2027-10-28"), "none");
  assert.equal(at("2027-10-29"), "prepare");
  assert.equal(at("2027-11-28"), "prepare");
  assert.equal(at("2027-11-29"), "can_apply");
  assert.equal(at("2028-01-29"), "can_apply");
  assert.equal(at("2028-01-30"), "h30");
});

test("kasus 9: zona Tokyo vs Jakarta (instan 2026-10-06 16:00 UTC): Tokyo h7, Jakarta h14 — pemanggil memakai zona TSK (Asia/Tokyo)", () => {
  const instant = "2026-10-06T16:00:00Z";
  assert.equal(ymdIn(instant, "Asia/Tokyo"), "2026-10-07");
  assert.equal(ymdIn(instant, "Asia/Jakarta"), "2026-10-06");
  assert.equal(st("2026-10-14", ymdIn(instant, "Asia/Tokyo")).stage, "h7");
  assert.equal(st("2026-10-14", ymdIn(instant, "Asia/Jakarta")).stage, "h14");
});

test("kasus 11 (revisi T-017): sudah diajukan = waiting_result, tahap TIDAK naik lagi walau H-14/H-7 lewat", () => {
  const r = st("2026-10-14", "2026-10-06", "applied");
  assert.deepEqual(r, { stage: "waiting_result", daysLeft: 8, additionalDocs: false, specialUntil: null });
  assert.equal(st("2026-10-14", "2026-10-13", "applied").stage, "waiting_result");
  assert.equal(st("2026-10-14", "2026-10-14", "applied").stage, "waiting_result");
  assert.equal(st("2027-05-31", "2027-02-01", "applied").stage, "waiting_result"); // diajukan lebih awal pun
});

test("diajukan lalu lewat tanggal habis = 特例期間: waiting_result dengan specialUntil = habis + 2 bulan (clamp akhir bulan)", () => {
  assert.deepEqual(st("2026-09-30", "2026-10-06", "applied"), { stage: "waiting_result", daysLeft: -6, additionalDocs: false, specialUntil: "2026-11-30" });
  assert.equal(st("2026-12-31", "2027-01-10", "applied").specialUntil, "2027-02-28"); // 31 Des + 2 bulan
  assert.equal(st("2026-10-14", "2026-10-14", "applied").specialUntil, null); // hari terakhir: belum lewat
  assert.equal(st("2026-10-14", "2026-10-15", "applied").specialUntil, "2026-12-14");
});

test("lewat batas 特例期間 tanpa hasil = special_overdue (perhatian); batas inklusif", () => {
  assert.equal(st("2026-09-30", "2026-11-30", "applied").stage, "waiting_result"); // hari terakhir 特例期間
  const r = st("2026-09-30", "2026-12-01", "applied");
  assert.equal(r.stage, "special_overdue");
  assert.equal(r.specialUntil, "2026-11-30");
  assert.equal(r.daysLeft, -62);
  assert.equal(st("2026-09-30", "2027-03-01", "additional_docs").stage, "special_overdue");
});

test("追加資料: tanda additionalDocs pada waiting_result (dan pada special_overdue); status lain tidak membawanya", () => {
  assert.deepEqual(st("2026-10-14", "2026-10-06", "additional_docs"), { stage: "waiting_result", daysLeft: 8, additionalDocs: true, specialUntil: null });
  assert.equal(st("2026-09-30", "2026-10-06", "additional_docs").specialUntil, "2026-11-30");
  assert.equal(st("2026-09-30", "2026-12-15", "additional_docs").additionalDocs, true);
  for (const s of ["not_started", "preparing", "applied", "rejected", "received"] as const) assert.equal(st("2026-10-14", "2026-10-06", s).additionalDocs, false, s);
});

test("不許可 (rejected): perhatian dan menghentikan pengingat biasa, berapa pun sisa harinya", () => {
  for (const [exp, today] of [["2027-12-31", "2026-10-06"], ["2026-10-14", "2026-10-06"], ["2026-09-30", "2026-10-06"], ["2026-09-30", "2027-06-01"]] as const) {
    assert.equal(st(exp, today, "rejected").stage, "rejected", `${exp} ${today}`);
  }
});

test("diambil pekerja sendiri atau staf: tahap sama (done); received_by tidak memengaruhi pengingat", () => {
  assert.equal(st("2027-03-31", "2027-03-01", "received", "2027-02-10").stage, "done");
  assert.deepEqual(Object.keys(st("2027-03-31", "2027-03-01", "received", "2027-02-10")).sort(), ["additionalDocs", "daysLeft", "specialUntil", "stage"]);
});

test("belum mulai dan persiapan memakai jadwal yang sama (status proses tidak mengubah tahap sebelum diajukan)", () => {
  for (const s of ["not_started", "preparing"] as const) {
    assert.equal(st("2026-10-14", "2026-10-06", s).stage, "h14");
    assert.equal(st("2027-03-31", "2026-11-30", s).stage, "prepare");
    assert.equal(st("2026-09-30", "2026-10-06", s).stage, "expired");
  }
});

test("urgensi dan tahap perhatian: setiap tahap punya peringkat; special_overdue dan rejected paling mendesak; waiting_result bukan perhatian", () => {
  const stages: CardStage[] = ["none", "prepare", "can_apply", "h30", "h14", "h7", "expired", "waiting_result", "special_overdue", "rejected", "done"];
  assert.deepEqual(Object.keys(STAGE_URGENCY).sort(), [...stages].sort());
  assert.ok(STAGE_URGENCY.h30 < STAGE_URGENCY.h14 && STAGE_URGENCY.h14 < STAGE_URGENCY.h7 && STAGE_URGENCY.h7 < STAGE_URGENCY.expired);
  assert.ok(STAGE_URGENCY.rejected > STAGE_URGENCY.expired && STAGE_URGENCY.special_overdue > STAGE_URGENCY.rejected);
  assert.equal(STAGE_URGENCY.none, 0);
  assert.deepEqual([...ATTENTION_STAGES].sort(), ["expired", "h14", "h30", "h7", "rejected", "special_overdue"]);
  for (const s of ["none", "prepare", "can_apply", "waiting_result", "done"] as const) assert.equal(isAttentionStage(s), false, s);
  for (const s of ATTENTION_STAGES) assert.equal(isAttentionStage(s), true, s);
});

test("kartu terkini: active dengan tanggal habis terbesar; seri = dibuat terakhir; void diabaikan; kosong = null", () => {
  const c = (id: string, status: string, expiryDate: string, createdAt: string) => ({ id, status, expiryDate, createdAt });
  assert.equal(currentCard([]), null);
  assert.equal(currentCard([c("v", "void", "2030-01-01", "2026-01-01T00:00:00Z")]), null);
  const cards = [c("old", "active", "2025-10-01", "2025-01-01T00:00:00Z"), c("new", "active", "2026-10-01", "2026-01-01T00:00:00Z"), c("void", "void", "2027-10-01", "2026-06-01T00:00:00Z")];
  assert.equal(currentCard(cards)?.id, "new");
  assert.equal(currentCard([c("a", "active", "2026-10-01", "2026-01-01T00:00:00Z"), c("b", "active", "2026-10-01", "2026-03-01T00:00:00Z")])?.id, "b");
  assert.equal(currentCard([{ id: "d", status: "active", expiryDate: "2026-10-01", createdAt: new Date("2026-01-01T00:00:00Z") }, { id: "e", status: "active", expiryDate: "2026-10-01", createdAt: new Date("2026-02-01T00:00:00Z") }])?.id, "e");
});

test("penerima pengingat: 担当 efektif dulu + semua Admin tanpa duplikat; tanpa 担当 = hanya Admin", () => {
  assert.deepEqual(cardRecipients({ responsibleStaffId: "s1", adminIds: ["a1", "a2"] }), ["s1", "a1", "a2"]);
  assert.deepEqual(cardRecipients({ responsibleStaffId: "a1", adminIds: ["a1", "a2"] }), ["a1", "a2"]); // 担当 sekaligus Admin: sekali
  assert.deepEqual(cardRecipients({ responsibleStaffId: null, adminIds: ["a1"] }), ["a1"]);
  assert.deepEqual(cardRecipients({ responsibleStaffId: "s1", adminIds: [] }), ["s1"]);
});

test("konfigurasi: status proses (6 nilai), pilihan 在留期間 4/6/12 bulan", () => {
  assert.deepEqual([...RENEWAL_STATUSES], ["not_started", "preparing", "applied", "additional_docs", "received", "rejected"]);
  assert.deepEqual([...PERIOD_OPTIONS], [4, 6, 12]);
  assert.equal(isPeriodOption(6), true);
  assert.equal(isPeriodOption(5), false);
});

// ---------------------------------------------------------------------------------------------------- daftar dan KPI (T-019)
import { CARD_VIEWS, compareCardItems, countViews, isActionNeeded, isCardView, matchesView, type CardListItem } from "../../src/db/zairyu";

const item = (expiryDate: string, status: RenewalStatus, today = "2026-10-07", hasCard = true): CardListItem => {
  if (!hasCard) return { hasCard: false, stage: null, additionalDocs: false };
  const r = cardStage({ expiryDate, renewalStatus: status, today });
  return { hasCard: true, stage: r.stage, additionalDocs: r.additionalDocs };
};

test("isActionNeeded: h30/h14/h7/expired/rejected/special_overdue dan waiting_result DENGAN 追加資料 = tindakan; waiting_result biasa, prepare, can_apply, none, done = bukan", () => {
  const need = (stage: CardStage, additionalDocs = false) => isActionNeeded({ stage, additionalDocs });
  for (const s of ["h30", "h14", "h7", "expired", "rejected", "special_overdue"] as const) assert.equal(need(s), true, s);
  assert.equal(need("waiting_result", true), true);
  for (const s of ["waiting_result", "prepare", "can_apply", "none", "done"] as const) assert.equal(need(s), false, s);
  assert.equal(need("prepare", true), false); // tanda 追加資料 hanya bermakna pada waiting_result
});

test("kelompok daftar/KPI dari data nyata: urgent, prepare, waiting (tanpa 追加資料), missing; tidak tumpang tindih", () => {
  const items: Record<string, CardListItem> = {
    h14: item("2026-10-17", "preparing"), // 10 hari
    expired: item("2026-10-01", "not_started"),
    rejected: item("2027-12-31", "rejected"),
    specialOver: item("2026-07-31", "applied"), // lewat habis + 2 bulan
    waitingDocs: item("2026-10-27", "additional_docs"),
    waitingPlain: item("2026-10-27", "applied"),
    waitingSpecial: item("2026-10-01", "applied"), // 特例期間
    prepare: item("2027-02-07", "not_started"), // 4 bulan
    canApply: item("2027-01-07", "preparing"), // 3 bulan
    none: item("2028-10-07", "not_started"),
    missing: item("", "not_started", "2026-10-07", false),
  };
  const view = (v: Exclude<(typeof CARD_VIEWS)[number], "all">) => Object.entries(items).filter(([, i]) => matchesView(i, v)).map(([k]) => k).sort();
  assert.deepEqual(view("urgent"), ["expired", "h14", "rejected", "specialOver", "waitingDocs"]);
  assert.deepEqual(view("prepare"), ["canApply", "prepare"]);
  assert.deepEqual(view("waiting"), ["waitingPlain", "waitingSpecial"]);
  assert.deepEqual(view("missing"), ["missing"]);
  assert.equal(Object.values(items).filter((i) => matchesView(i, "all")).length, 11);
  assert.deepEqual(countViews(Object.values(items)), { urgent: 5, prepare: 2, waiting: 2, missing: 1 });
  // tidak ada pekerja yang masuk dua kelompok
  const seen = new Set<string>();
  for (const v of ["urgent", "prepare", "waiting", "missing"] as const) for (const k of view(v)) { assert.equal(seen.has(k), false, `${k} ganda`); seen.add(k); }
  assert.equal(isCardView("urgent"), true);
  assert.equal(isCardView("bogus"), false);
});

test("urutan daftar: tahap paling mendesak dulu, lalu sisa hari naik, lalu nama; tanpa kartu paling akhir", () => {
  const rows = [
    { name: "Z tanpa", stage: null, daysLeft: null },
    { name: "B h30", stage: "h30" as const, daysLeft: 20 },
    { name: "A h30", stage: "h30" as const, daysLeft: 20 },
    { name: "C h30", stage: "h30" as const, daysLeft: 5 + 10 },
    { name: "D expired", stage: "expired" as const, daysLeft: -3 },
    { name: "E special", stage: "special_overdue" as const, daysLeft: -70 },
    { name: "F waiting", stage: "waiting_result" as const, daysLeft: 3 },
    { name: "G none", stage: "none" as const, daysLeft: 400 },
  ];
  assert.deepEqual([...rows].sort(compareCardItems).map((r) => r.name), ["E special", "D expired", "C h30", "A h30", "B h30", "F waiting", "G none", "Z tanpa"]);
});
