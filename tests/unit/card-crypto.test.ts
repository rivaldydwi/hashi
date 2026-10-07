import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  CardDecryptError, CardKeyError, decryptBytes, decryptText, encryptBytes, encryptText, loadKeyring, maskCardNumber, normalizeCardNumber, numberAad, photoAad,
} from "../../src/lib/card-crypto";

// Enkripsi nomor/foto 在留カード (T-020). Kunci dibuat acak di sini, tidak ada kunci tetap di repo.
const newKey = () => randomBytes(32).toString("base64");
const ring = (env: Record<string, string> = {}) => loadKeyring({ CARD_DATA_KEY: newKey(), ...env });

test("teks: bolak-balik, nonce acak (dua sandi dari nilai sama berbeda), tidak memuat nilai asli", () => {
  const r = ring();
  const a = encryptText("AB12345678CD", numberAad("c1"), r);
  const b = encryptText("AB12345678CD", numberAad("c1"), r);
  assert.notEqual(a.value, b.value);
  assert.ok(a.value.startsWith("hcd1:k1:"));
  assert.ok(!a.value.includes("AB12345678CD"));
  assert.equal(decryptText(a.value, numberAad("c1"), r), "AB12345678CD");
  assert.equal(decryptText(b.value, numberAad("c1"), r), "AB12345678CD");
});

test("teks: kunci salah, data rusak, dan tujuan (AAD) berbeda = gagal", () => {
  const r = ring();
  const { value } = encryptText("AB12345678CD", numberAad("c1"), r);
  assert.throws(() => decryptText(value, numberAad("c1"), ring()), CardDecryptError); // kunci lain, id sama
  assert.throws(() => decryptText(value, numberAad("c2"), r), CardDecryptError); // dipindah ke kartu lain
  const parts = value.split(":");
  const flipped = [...parts.slice(0, 3), (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1)].join(":");
  assert.throws(() => decryptText(flipped, numberAad("c1"), r), CardDecryptError); // ciphertext diubah
  assert.throws(() => decryptText(value.slice(0, -4), numberAad("c1"), r), CardDecryptError); // terpotong
  assert.throws(() => decryptText("AB12345678CD", numberAad("c1"), r), CardDecryptError); // polos, bukan sandi
});

test("biner: bolak-balik, nonce acak, tidak memuat byte asli, rusak/AAD lain/kunci salah = gagal", () => {
  const r = ring();
  const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
  const a = encryptBytes(photo, photoAad("p1"), r);
  const b = encryptBytes(photo, photoAad("p1"), r);
  assert.ok(!a.data.equals(b.data));
  assert.ok(a.data.subarray(0, 4).equals(Buffer.from("HCD1")));
  assert.ok(!a.data.includes(photo.subarray(0, 64)), "isi asli tidak muncul di berkas sandi");
  assert.ok(decryptBytes(a.data, photoAad("p1"), r).equals(photo));
  assert.throws(() => decryptBytes(a.data, photoAad("p2"), r), CardDecryptError);
  assert.throws(() => decryptBytes(a.data, photoAad("p1"), ring()), CardDecryptError);
  const broken = Buffer.from(a.data);
  broken[broken.length - 20] ^= 0x01;
  assert.throws(() => decryptBytes(broken, photoAad("p1"), r), CardDecryptError);
  assert.throws(() => decryptBytes(photo, photoAad("p1"), r), CardDecryptError); // JPG polos bukan berkas sandi
  assert.throws(() => decryptBytes(a.data.subarray(0, 20), photoAad("p1"), r), CardDecryptError);
});

test("kunci: tanpa kunci / panjang salah / bukan base64 / id buruk = CardKeyError dengan pesan jelas (tanpa nilai kunci)", () => {
  assert.throws(() => loadKeyring({}), (e: Error) => e instanceof CardKeyError && /CARD_DATA_KEY belum diisi/.test(e.message));
  assert.throws(() => loadKeyring({ CARD_DATA_KEY: "" }), CardKeyError);
  assert.throws(() => loadKeyring({ CARD_DATA_KEY: randomBytes(16).toString("base64") }), CardKeyError);
  const secret = "bukan-base64-!!!";
  assert.throws(() => loadKeyring({ CARD_DATA_KEY: secret }), (e: Error) => e instanceof CardKeyError && !e.message.includes(secret));
  assert.throws(() => loadKeyring({ CARD_DATA_KEY: newKey(), CARD_DATA_KEY_ID: "k 1!" }), CardKeyError);
  assert.throws(() => loadKeyring({ CARD_DATA_KEY: newKey(), CARD_DATA_KEYS_OLD: "rusak" }), CardKeyError);
});

test("rotasi kunci: sandi lama tetap terbuka lewat CARD_DATA_KEYS_OLD, sandi baru memakai key_id baru", () => {
  const oldKey = newKey();
  const r1 = loadKeyring({ CARD_DATA_KEY: oldKey, CARD_DATA_KEY_ID: "k1" });
  const old = encryptText("AB12345678CD", numberAad("c1"), r1);
  const r2 = loadKeyring({ CARD_DATA_KEY: newKey(), CARD_DATA_KEY_ID: "k2", CARD_DATA_KEYS_OLD: `k1=${oldKey}` });
  assert.equal(decryptText(old.value, numberAad("c1"), r2), "AB12345678CD");
  const fresh = encryptText("AB12345678CD", numberAad("c1"), r2);
  assert.equal(fresh.keyId, "k2");
  assert.ok(fresh.value.startsWith("hcd1:k2:"));
  assert.throws(() => decryptText(old.value, numberAad("c1"), loadKeyring({ CARD_DATA_KEY: newKey(), CARD_DATA_KEY_ID: "k2" })), CardDecryptError); // kunci lama tidak didaftarkan
});

test("nomor kartu: format 2 huruf + 8 angka + 2 huruf, dirapikan; tersamar AB********CD", () => {
  assert.equal(normalizeCardNumber(" ab-1234 5678 cd "), "AB12345678CD");
  for (const bad of ["", "AB1234567CD", "A112345678CD", "AB12345678C", "AB12345678CDE", "12345678ABCD"]) assert.equal(normalizeCardNumber(bad), null, bad);
  assert.equal(maskCardNumber("AB12345678CD"), "AB********CD");
});
