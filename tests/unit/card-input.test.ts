import assert from "node:assert/strict";
import { test } from "node:test";
import { EDITABLE_STATUSES, expiryMax, looksLikeCardNumber, parseCreate, parseHandover, parseReceive, parseUpdate, parseVoidReason, validYmd } from "../../src/features/cards/input";

const today = "2026-10-07";
const F = "0b6a9a64-2f6d-4f3e-9f55-3b8a6c0d1e11";
const base = { skillFieldId: F, periodMonths: "12", expiryDate: "2027-03-31", note: "", renewalStatus: "preparing" };

test("tanggal: validYmd menolak format dan tanggal mustahil (2026-02-30)", () => {
  assert.equal(validYmd("2026-10-07"), true);
  for (const v of ["2026-02-30", "2026-13-01", "26-10-07", "2026/10/07", "", "2026-10-07T00:00"]) assert.equal(validYmd(v), false, v);
  assert.equal(expiryMax("2026-10-07"), "2032-10-07");
});

test("nomor kartu di catatan ditolak (format 2 huruf + 8 angka + 2 huruf, dengan/ tanpa spasi), teks wajar lolos", () => {
  assert.equal(looksLikeCardNumber("AB12345678CD"), true);
  assert.equal(looksLikeCardNumber("ab 1234 5678 cd"), true);
  assert.equal(looksLikeCardNumber("Menunggu dokumen dari perusahaan, tel 090-1234-5678"), false);
  assert.equal(looksLikeCardNumber("Paspor AB1234567 sudah diperbarui"), false);
  assert.deepEqual(parseCreate({ ...base, note: "nomor: AB12345678CD" }, today), { ok: false, error: "noteCardNumber" });
});

test("kartu pertama: status awal not_started tanpa tanggal proses; bidang wajib UUID; 在留期間 hanya 4/6/12 atau kosong; tanggal habis dalam rentang", () => {
  const ok = parseCreate(base, today);
  assert.deepEqual(ok, { ok: true, value: { skillFieldId: F, periodMonths: 12, expiryDate: "2027-03-31", note: null, renewalStatus: "not_started", appliedOn: null, additionalDocsOn: null, rejectedOn: null } });
  assert.deepEqual(parseCreate({ ...base, periodMonths: "" }, today).ok && (parseCreate({ ...base, periodMonths: "" }, today) as { value: { periodMonths: null } }).value.periodMonths, null);
  assert.deepEqual(parseCreate({ ...base, periodMonths: "5" }, today), { ok: false, error: "periodInvalid" });
  assert.deepEqual(parseCreate({ ...base, skillFieldId: "" }, today), { ok: false, error: "fieldRequired" });
  assert.deepEqual(parseCreate({ ...base, expiryDate: "2019-12-31" }, today), { ok: false, error: "expiryRange" });
  assert.deepEqual(parseCreate({ ...base, expiryDate: "2033-01-01" }, today), { ok: false, error: "expiryRange" });
  assert.deepEqual(parseCreate({ ...base, expiryDate: "2026-09-01" }, today).ok, true); // sudah lewat boleh (data dimasukkan terlambat)
  assert.deepEqual(parseCreate({ ...base, expiryDate: "2027-02-30" }, today), { ok: false, error: "dateInvalid" });
  assert.deepEqual(parseCreate({ ...base, note: "x".repeat(2001) }, today), { ok: false, error: "noteTooLong" });
});

test("ubah: status received tidak bisa dipilih di sini; belum mulai/persiapan membuang tanggal proses", () => {
  assert.equal(EDITABLE_STATUSES.includes("received" as never), false);
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "received" }, today), { ok: false, error: "statusInvalid" });
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "bogus" }, today), { ok: false, error: "statusInvalid" });
  const r = parseUpdate({ ...base, renewalStatus: "preparing", appliedOn: "2026-09-01", additionalDocsOn: "2026-09-05", rejectedOn: "2026-09-06" }, today);
  assert.ok(r.ok && r.value.appliedOn === null && r.value.additionalDocsOn === null && r.value.rejectedOn === null);
});

test("ubah: diajukan, 追加資料, 不許可 wajib tanggal pengajuan; 追加資料 wajib tanggal diminta; 不許可 wajib tanggal ditolak; urutan dan masa depan", () => {
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "applied" }, today), { ok: false, error: "appliedRequired" });
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "applied", appliedOn: "2026-10-08" }, today), { ok: false, error: "dateFuture" });
  const applied = parseUpdate({ ...base, renewalStatus: "applied", appliedOn: "2026-09-20" }, today);
  assert.ok(applied.ok && applied.value.appliedOn === "2026-09-20" && applied.value.additionalDocsOn === null);
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "additional_docs", appliedOn: "2026-09-20" }, today), { ok: false, error: "additionalRequired" });
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "additional_docs", appliedOn: "2026-09-20", additionalDocsOn: "2026-09-19" }, today), { ok: false, error: "datesOrder" });
  const docs = parseUpdate({ ...base, renewalStatus: "additional_docs", appliedOn: "2026-09-20", additionalDocsOn: "2026-10-01", note: "Minta salinan kontrak" }, today);
  assert.ok(docs.ok && docs.value.additionalDocsOn === "2026-10-01" && docs.value.rejectedOn === null && docs.value.note === "Minta salinan kontrak");
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "rejected", appliedOn: "2026-09-20" }, today), { ok: false, error: "rejectedRequired" });
  assert.deepEqual(parseUpdate({ ...base, renewalStatus: "rejected", appliedOn: "2026-09-20", rejectedOn: "2026-09-10" }, today), { ok: false, error: "datesOrder" });
  const rej = parseUpdate({ ...base, renewalStatus: "rejected", appliedOn: "2026-09-20", rejectedOn: "2026-10-05", additionalDocsOn: "2026-10-01" }, today);
  assert.ok(rej.ok && rej.value.rejectedOn === "2026-10-05" && rej.value.additionalDocsOn === null); // tanggal milik status lain dibuang
});

const ex = { appliedOn: "2026-09-20", expiryDate: "2026-12-31", skillFieldId: F };
const rec = { receivedOn: "2026-10-05", receivedBy: "staff", handedOverOn: "", newExpiryDate: "2027-12-31", newPeriodMonths: "12", newSkillFieldId: "" };

test("terima kartu baru: tanggal diterima ≥ pengajuan, oleh staf/pekerja, tanggal serah hanya untuk staf, kartu baru lebih akhir; bidang bawaan = kartu lama", () => {
  assert.deepEqual(parseReceive(rec, ex, today), { ok: true, value: { receivedOn: "2026-10-05", receivedBy: "staff", handedOverOn: null, next: { skillFieldId: F, periodMonths: 12, expiryDate: "2027-12-31" } } });
  const handed = parseReceive({ ...rec, handedOverOn: "2026-10-06" }, ex, today);
  assert.ok(handed.ok && handed.value.handedOverOn === "2026-10-06");
  assert.deepEqual(parseReceive({ ...rec, receivedBy: "worker", handedOverOn: "2026-10-06" }, ex, today), { ok: false, error: "handoverNotStaff" });
  assert.deepEqual(parseReceive({ ...rec, receivedBy: "worker" }, ex, today).ok, true); // diambil pekerja sendiri
  assert.deepEqual(parseReceive({ ...rec, receivedBy: "pos" }, ex, today), { ok: false, error: "receivedByInvalid" });
  assert.deepEqual(parseReceive({ ...rec, handedOverOn: "2026-10-04" }, ex, today), { ok: false, error: "handoverBeforeReceived" });
  assert.deepEqual(parseReceive({ ...rec, receivedOn: "2026-09-19" }, ex, today), { ok: false, error: "datesOrder" });
  assert.deepEqual(parseReceive({ ...rec, receivedOn: "2026-10-08" }, ex, today), { ok: false, error: "dateFuture" });
  assert.deepEqual(parseReceive({ ...rec, receivedOn: "" }, ex, today), { ok: false, error: "receivedOnRequired" });
  assert.deepEqual(parseReceive({ ...rec, newExpiryDate: "" }, ex, today), { ok: false, error: "newExpiryRequired" });
  assert.deepEqual(parseReceive({ ...rec, newExpiryDate: "2026-12-31" }, ex, today), { ok: false, error: "newExpiryNotLater" });
  assert.deepEqual(parseReceive({ ...rec, newPeriodMonths: "7" }, ex, today), { ok: false, error: "periodInvalid" });
  assert.deepEqual(parseReceive(rec, { ...ex, appliedOn: null }, today), { ok: false, error: "appliedMissing" });
  const other = "11111111-2222-4333-8444-555555555555";
  const changed = parseReceive({ ...rec, newSkillFieldId: other }, ex, today);
  assert.ok(changed.ok && changed.value.next.skillFieldId === other);
});

test("serah ke pekerja: hanya kartu yang diterima staf, tidak lebih awal dari diterima, tidak di masa depan", () => {
  const e = { receivedOn: "2026-10-05", receivedBy: "staff" };
  assert.deepEqual(parseHandover({ handedOverOn: "2026-10-06" }, e, today), { ok: true, value: "2026-10-06" });
  assert.deepEqual(parseHandover({ handedOverOn: "2026-10-04" }, e, today), { ok: false, error: "handoverBeforeReceived" });
  assert.deepEqual(parseHandover({ handedOverOn: "2026-10-09" }, e, today), { ok: false, error: "dateFuture" });
  assert.deepEqual(parseHandover({ handedOverOn: "" }, e, today), { ok: false, error: "dateInvalid" });
  assert.deepEqual(parseHandover({ handedOverOn: "2026-10-06" }, { receivedOn: "2026-10-05", receivedBy: "worker" }, today), { ok: false, error: "handoverNotStaff" });
});

test("alasan pembatalan wajib dan dipotong 1000 karakter", () => {
  assert.deepEqual(parseVoidReason("  "), { ok: false, error: "invalid" });
  assert.deepEqual(parseVoidReason(" salah input "), { ok: true, value: "salah input" });
  const r = parseVoidReason("x".repeat(1500));
  assert.ok(r.ok && r.value.length === 1000);
});
