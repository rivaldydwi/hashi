import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { checkImage, sanitizeImage, sniffImage } from "../../src/features/records/images";
import { cleanSections, cellState, fiscalMonths, fiscalYearOf, quarterOfMonth, CASE_CODE } from "../../src/db/records-core";

async function jpegWithExif(orientation = 6) {
  return sharp({ create: { width: 200, height: 100, channels: 3, background: "#c2410c" } })
    .withExif({ IFD0: { Copyright: "rahasia-uji", Make: "KameraUji" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 40/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "139/1 45/1 0/1" } })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

test("tipe gambar dikenali dari isi: JPEG/PNG/WebP lolos, HEIC ditolak dengan alasan sendiri, selain itu tidak valid", async () => {
  assert.equal((sniffImage(await jpegWithExif()) as { kind: { ext: string } }).kind.ext, "jpg");
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer();
  assert.equal((sniffImage(png) as { kind: { ext: string } }).kind.ext, "png");
  assert.equal((sniffImage(webp) as { kind: { ext: string } }).kind.ext, "webp");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
  assert.deepEqual(sniffImage(heic), { error: "heic" });
  assert.deepEqual(sniffImage(Buffer.from("%PDF-1.4 bukan gambar")), { error: "invalidType" });
  assert.deepEqual(sniffImage(Buffer.from("<svg onload=alert(1)>")), { error: "invalidType" });
  assert.deepEqual(checkImage(new Uint8Array(0)), { error: "tooBig" });
  assert.deepEqual(checkImage(new Uint8Array(10 * 1024 * 1024 + 1)), { error: "tooBig" });
});

test("sanitize: rotasi EXIF diterapkan lalu semua metadata (EXIF, GPS) dibuang", async () => {
  const input = await jpegWithExif(6);
  const before = await sharp(input).metadata();
  assert.ok(before.exif, "fixture harus punya EXIF");
  assert.ok(before.exif!.toString("latin1").includes("rahasia-uji"));
  const out = await sanitizeImage(input, { mime: "image/jpeg", ext: "jpg" });
  const after = await sharp(out).metadata();
  assert.equal(after.exif, undefined);
  assert.equal(after.icc, undefined);
  assert.ok(!out.toString("latin1").includes("rahasia-uji") && !out.toString("latin1").includes("KameraUji"));
  assert.ok(!out.includes(Buffer.from("GPS")));
  // orientasi 6 (putar 90°): 200x100 menjadi 100x200 dan tanda orientasi hilang
  assert.deepEqual([after.width, after.height], [100, 200]);
  assert.equal(after.orientation, undefined);
});

test("sanitize: gambar besar diperkecil ke maksimum 4096 px dan PNG tetap PNG", async () => {
  const big = await sharp({ create: { width: 5000, height: 1000, channels: 3, background: "#123456" } }).png().toBuffer();
  const out = await sanitizeImage(big, { mime: "image/png", ext: "png" });
  const m = await sharp(out).metadata();
  assert.equal(m.format, "png");
  assert.equal(m.width, 4096);
});

test("tahun fiskal April-Maret, kuartal, dan 12 bulannya", () => {
  assert.equal(fiscalYearOf("2026-04-01"), 2026);
  assert.equal(fiscalYearOf("2027-03-31"), 2026);
  assert.equal(fiscalYearOf("2026-03-31"), 2025);
  assert.deepEqual(fiscalMonths(2026).slice(0, 2), ["2026-04-01", "2026-05-01"]);
  assert.deepEqual(fiscalMonths(2026).slice(9), ["2027-01-01", "2027-02-01", "2027-03-01"]);
  assert.deepEqual(["2026-04-01", "2026-06-01", "2026-07-01", "2026-12-01", "2027-01-01", "2027-03-01"].map(quarterOfMonth), [1, 1, 2, 3, 4, 4]);
});

test("keadaan sel wawancara berkala: selesai, belum, tidak berlaku, belum jatuh tempo", () => {
  const today = "2026-10-05";
  const done = { applicable: true, resultStatus: "no_issue", interviewDate: "2026-08-10" };
  assert.equal(cellState("2026-08-01", done, today, "2025-12-01"), "done");
  assert.equal(cellState("2026-08-01", undefined, today, "2025-12-01"), "pending");
  assert.equal(cellState("2026-10-01", undefined, today, "2025-12-01"), "pending"); // bulan berjalan tanpa wawancara = belum
  assert.equal(cellState("2026-11-01", undefined, today, "2025-12-01"), "notDue");
  assert.equal(cellState("2026-08-01", { applicable: false, resultStatus: null, interviewDate: null }, today, null), "na");
  assert.equal(cellState("2026-08-01", { applicable: true, resultStatus: "not_done", interviewDate: null }, today, null), "pending");
  assert.equal(cellState("2026-05-01", undefined, today, "2026-07-15"), "notDue"); // sebelum mulai kerja tidak ditagih
});

test("cleanSections membuang poin kosong, kunci asing, dan bagian kosong", () => {
  assert.deepEqual(cleanSections({ consultation: ["  a ", "", "b"], pending: [], hack: ["x"], workerView: "bukan array" }), { consultation: ["a", "b"] });
  assert.deepEqual(cleanSections(null), {});
});

test("bentuk kode kasus", () => {
  assert.ok(CASE_CODE.test("K-2026-0001"));
  assert.ok(!CASE_CODE.test("K-26-1"));
});
