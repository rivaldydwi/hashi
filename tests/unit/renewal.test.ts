import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRenewal, dateBoth, defaultRenewalReason, missingItems, passportName, periodJa, toWareki, type RenewalInput } from "../../src/db/renewal";

// Pemetaan butir 1-14 perpanjangan 在留カード (T-021): romaji, tanggal 西暦/和暦, butir kosong, peringatan paspor.
const base: RenewalInput = {
  fullName: "Budi Santoso", birthDate: "1999-03-04", gender: "MALE", maritalStatus: "SINGLE", homeAddress: "Jl. Mawar 1, Bandung", addressJp: "東京都新宿区1-2-3", phoneJp: "090-1234-5678",
  passportNumber: "C1234567", passportExpiry: "2031-01-15", card: { periodMonths: 12, expiryDate: "2027-03-31", hasNumber: true }, companyName: "株式会社テスト", fieldNameJa: "飲食料品製造業", today: "2026-10-08",
};
const item = (r: ReturnType<typeof buildRenewal>, no: number) => r.items.find((x) => x.no === no)!;

test("和暦: batas era, tahun pertama 元年, di luar jangkauan = null", () => {
  assert.equal(toWareki("2026-10-08"), "令和8年10月8日");
  assert.equal(toWareki("2019-05-01"), "令和元年5月1日");
  assert.equal(toWareki("2019-04-30"), "平成31年4月30日");
  assert.equal(toWareki("1989-01-08"), "平成元年1月8日");
  assert.equal(toWareki("1989-01-07"), "昭和64年1月7日");
  assert.equal(toWareki("1926-12-25"), "昭和元年12月25日");
  assert.equal(toWareki("1999-03-04"), "平成11年3月4日");
  assert.equal(toWareki("1800-01-01"), null);
  assert.equal(toWareki("2026-13-40"), null);
  assert.equal(dateBoth("2027-03-31"), "2027/03/31（令和9年3月31日）");
});

test("在留期間: 4か月, 6か月, 1年, 1年6か月", () => {
  assert.deepEqual([4, 6, 12, 18, 24].map(periodJa), ["4か月", "6か月", "1年", "1年6か月", "2年"]);
});

test("romaji: kapital, aksen dibuang, simbol dibuang; marga = kata terakhir (perkiraan); nama tunggal = marga saja", () => {
  assert.deepEqual(passportName("Budi Santoso"), { full: "BUDI SANTOSO", family: "SANTOSO", given: "BUDI", guess: true });
  assert.deepEqual(passportName("  siti   nur  Hasanah "), { full: "SITI NUR HASANAH", family: "HASANAH", given: "SITI NUR", guess: true });
  assert.equal(passportName("José Müller-Ñ").full, "JOSE MULLER-N");
  assert.deepEqual(passportName("Sukarno"), { full: "SUKARNO", family: "SUKARNO", given: "", guess: true });
  assert.equal(passportName("Dewi (S.) 123").full, "DEWI S");
});

test("butir lengkap: nilai, 西暦 + 和暦, 男/女, 有/無, 性別; tidak ada butir kosong dan tanpa peringatan", () => {
  const r = buildRenewal(base);
  assert.deepEqual(missingItems(r.items), []);
  assert.deepEqual(r.warnings, []);
  assert.equal(item(r, 1).values[0].text, "インドネシア");
  assert.deepEqual(item(r, 2).values[0], { text: "1999/03/04", sub: "平成11年3月4日" });
  assert.deepEqual(item(r, 3).values.map((v) => `${v.label}=${v.text}`), ["FULL=BUDI SANTOSO", "FAMILY=SANTOSO", "GIVEN=BUDI"]);
  assert.equal(item(r, 4).values[0].text, "男");
  assert.equal(item(r, 5).values[0].text, "無");
  assert.equal(item(r, 6).values[0].text, "会社員");
  assert.equal(item(r, 8).values[0].text, "東京都新宿区1-2-3");
  assert.deepEqual(item(r, 10).values.map((v) => v.text), ["C1234567", "2031/01/15"]);
  assert.deepEqual(item(r, 11).values.map((v) => v.text), ["特定技能1号", "1年", "2027/03/31"]);
  assert.equal(item(r, 11).values[2].sub, "令和9年3月31日");
  assert.equal(item(r, 13).values[0].text, "1年"); // bawaan = 在留期間 kartu sekarang
  assert.equal(buildRenewal({ ...base, gender: "FEMALE", maritalStatus: "MARRIED" }).items[3].values[0].text, "女");
  assert.equal(item(buildRenewal({ ...base, maritalStatus: "MARRIED" }), 5).values[0].text, "有");
  assert.equal(item(buildRenewal({ ...base, maritalStatus: "DIVORCED" }), 5).values[0].text, "無");
});

test("nomor kartu (butir 12) TIDAK pernah berisi nilai: secret = true; kosong bila belum tersimpan", () => {
  const r = buildRenewal(base);
  assert.equal(item(r, 12).secret, true);
  assert.deepEqual(item(r, 12).values, []);
  assert.equal(item(r, 12).missing, false);
  assert.equal(item(buildRenewal({ ...base, card: { ...base.card!, hasNumber: false } }), 12).missing, true);
});

test("butir kosong ditandai dengan tempat memperbaikinya (profil / kartu / data Jepang / paspor)", () => {
  const r = buildRenewal({ ...base, birthDate: null, maritalStatus: null, homeAddress: " ", addressJp: null, phoneJp: "", passportNumber: null, card: null });
  const miss = missingItems(r.items).map((x) => `${x.no}:${x.fix}`);
  assert.deepEqual(miss, ["2:profile", "5:profile", "7:profile", "8:jp", "9:jp", "10:passport", "11:card", "12:card", "13:card"]);
  assert.ok(r.warnings.includes("noCard"));
  // paspor setengah terisi (nomor saja) tetap kosong, nilai yang ada tetap tampil
  const half = buildRenewal({ ...base, passportExpiry: null });
  assert.equal(item(half, 10).missing, true);
  assert.deepEqual(item(half, 10).values.map((v) => v.text), ["C1234567"]);
});

test("peringatan paspor: sudah kedaluwarsa; atau habis sebelum/pada 満了日 kartu; aman bila sesudahnya", () => {
  assert.deepEqual(buildRenewal({ ...base, passportExpiry: "2026-10-07" }).warnings, ["passportExpired"]);
  assert.deepEqual(buildRenewal({ ...base, passportExpiry: "2027-03-31" }).warnings, ["passportBeforeCardExpiry"]);
  assert.deepEqual(buildRenewal({ ...base, passportExpiry: "2027-03-30" }).warnings, ["passportBeforeCardExpiry"]);
  assert.deepEqual(buildRenewal({ ...base, passportExpiry: "2027-04-01" }).warnings, []);
  assert.deepEqual(buildRenewal({ ...base, passportExpiry: null }).warnings, []);
});

test("butir 14: templat bawaan memuat perusahaan + bidang, bisa disunting (editable), butir 15 dan 16 hanya pengingat", () => {
  const r = buildRenewal(base);
  assert.equal(item(r, 14).editable, true);
  assert.match(item(r, 14).values[0].text, /株式会社テストにおいて飲食料品製造業分野の業務に従事するため/);
  assert.match(defaultRenewalReason(null, null), /現在の所属機関において特定技能に係る業務に/);
  assert.equal(item(r, 15).reminder, true);
  assert.equal(item(r, 16).reminder, true);
  assert.deepEqual(missingItems(buildRenewal({ ...base, card: null }).items).filter((x) => x.reminder), []);
});
