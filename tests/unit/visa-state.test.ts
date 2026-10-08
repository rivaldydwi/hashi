import assert from "node:assert/strict";
import { test } from "node:test";
import { RENEWAL_STATUSES, VISA_CODES, VISA_STATES, addDays, cardStage, visaCodeOf, visaState, type CardStage } from "../../src/db/zairyu";

// Status visa untuk LPK (T-024): diturunkan dari kartu aktif terkini; hanya none / valid / renewing / expired. Dites untuk SEMUA tahap kartu.
const today = "2026-10-08";
const card = (offset: number, renewalStatus: (typeof RENEWAL_STATUSES)[number]) => ({ expiryDate: addDays(today, offset), renewalStatus });

test("tanpa kartu = none", () => assert.equal(visaState(null, today), "none"));

test("belum diajukan (not_started/preparing): valid sampai HARI HABIS (hari itu masih berlaku), expired sehari sesudahnya", () => {
  for (const st of ["not_started", "preparing"] as const) {
    assert.equal(visaState(card(200, st), today), "valid");
    assert.equal(visaState(card(0, st), today), "valid", "hari terakhir masih berlaku");
    assert.equal(visaState(card(-1, st), today), "expired");
    assert.equal(visaState(card(-90, st), today), "expired");
  }
});

test("sudah diajukan / menunggu hasil (applied, additional_docs): renewing, juga setelah tanggal habis dan setelah 特例期間", () => {
  for (const st of ["applied", "additional_docs"] as const) for (const off of [100, 10, 0, -1, -20, -90, -400]) assert.equal(visaState(card(off, st), today), "renewing", `${st} ${off}`);
});

test("ditolak (rejected) dan diterima (received) mengikuti tanggal habis: valid bila belum lewat, expired bila lewat", () => {
  for (const st of ["rejected", "received"] as const) {
    assert.equal(visaState(card(30, st), today), "valid");
    assert.equal(visaState(card(-1, st), today), "expired");
  }
});

test("setiap tahap kartu (cardStage) menghasilkan status visa yang masuk akal dan hanya dari daftar tetap", () => {
  const byStage: Partial<Record<CardStage, Set<string>>> = {};
  for (const st of RENEWAL_STATUSES) {
    for (const off of [300, 105, 70, 25, 11, 4, 0, -6, -20, -90]) {
      const c = card(off, st);
      const stage = cardStage({ ...c, receivedOn: st === "received" ? addDays(today, -1) : null, today }).stage;
      const v = visaState(c, today);
      assert.ok((VISA_STATES as readonly string[]).includes(v));
      (byStage[stage] ??= new Set()).add(v);
    }
  }
  // tahap yang masih berlaku -> valid; lewat tanpa pengajuan -> expired; menunggu hasil / lewat 特例期間 -> renewing
  for (const s of ["none", "prepare", "can_apply", "h30", "h14", "h7"] as const) assert.deepEqual([...(byStage[s] ?? [])], ["valid"], s);
  assert.deepEqual([...(byStage.expired ?? [])], ["expired"]);
  for (const s of ["waiting_result", "special_overdue"] as const) assert.deepEqual([...(byStage[s] ?? [])], ["renewing"], s);
  // rejected: valid bila kartu belum habis, expired bila sudah habis
  assert.deepEqual([...(byStage.rejected ?? [])].sort(), ["expired", "valid"]);
});

test("kode lencana: VISA_NONE/VALID/RENEWING/EXPIRED, satu-satu dengan status", () => {
  assert.deepEqual([...VISA_CODES], ["VISA_NONE", "VISA_VALID", "VISA_RENEWING", "VISA_EXPIRED"]);
  assert.deepEqual(VISA_STATES.map(visaCodeOf), [...VISA_CODES]);
});
