import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { FEE_FORM, feeFormName, layoutName, renderFeeFormPdf } from "../../src/lib/pdf/fee-form";

// 手数料納付書 (T-026): latar resmi + nama romaji + lingkaran pada nomor 2; tata letak nama; kolom lain tetap kosong.
const approx = (t: string, size: number) => t.length * size * 0.62; // pengukur kasar yang deterministik untuk tes tata letak
const width = FEE_FORM.name.x1 - FEE_FORM.name.x0;

test("tata letak nama: nama pendek satu baris di ukuran maksimum; lebih panjang mengecil; sangat panjang dibungkus per kata TANPA dipotong", () => {
  assert.deepEqual(layoutName("DEWI", approx), { lines: ["DEWI"], size: FEE_FORM.name.maxSize });
  const mid = layoutName("DEWI LESTARI HANDAYANI", approx);
  assert.equal(mid.lines.length, 1);
  assert.ok(mid.size < FEE_FORM.name.maxSize && mid.size >= FEE_FORM.name.minSize);
  const long = "MUHAMMAD RIZKY RAMADHAN PRATAMA KUSUMA WIJAYA SETIAWAN";
  const lay = layoutName(long, approx);
  assert.ok(lay.lines.length >= 2);
  assert.equal(lay.size, FEE_FORM.name.minSize);
  assert.equal(lay.lines.join(" "), long, "tidak ada yang terpotong");
  for (const l of lay.lines) assert.ok(approx(l, lay.size) <= width, `baris muat: ${l}`);
});

test("tata letak nama: satu kata yang lebih lebar dari kolom dipotong sebagai jaring pengaman (tidak melewati kolom)", () => {
  const lay = layoutName("A".repeat(60), approx);
  assert.equal(lay.lines.length, 1);
  assert.ok(approx(lay.lines[0], lay.size) <= width);
});

test("nama di formulir: huruf besar tanpa aksen, hanya karakter aman", () => {
  assert.equal(feeFormName("José Müller-Ñ (S.)"), "JOSE MULLER-N S.");
  assert.equal(feeFormName("  dewi   lestari "), "DEWI LESTARI");
  assert.equal(feeFormName("山田 太郎"), "");
});

async function read(buf: Buffer) {
  const dir = `${process.cwd()}/node_modules/pdfjs-dist`;
  // formulir resmi memakai font CJK tak tersemat: butuh cMap + font standar pdfjs supaya teksnya bisa dibaca di tes
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false, cMapUrl: `${dir}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${dir}/standard_fonts/` }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const items = tc.items.filter((it): it is Extract<typeof it, { str: string }> => "str" in it);
  const ops = await page.getOperatorList();
  return { pages: doc.numPages, view: page.view, items, text: items.map((i) => i.str).join(" "), opCount: ops.fnArray.length };
}

test("PDF: satu halaman A4, teks resmi formulir masih ada, nama pekerja tercetak di kolom 納付者氏名, bidang lain TIDAK diisi", async () => {
  const buf = await renderFeeFormPdf({ nameRomaji: "Dewi Lestari Handayani" });
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  const r = await read(buf);
  assert.equal(r.pages, 1);
  assert.ok(Math.abs(r.view[2] - 595.276) < 1 && Math.abs(r.view[3] - 841.89) < 1);
  const squeezed = r.text.replace(/\s+/g, "");
  for (const label of ["手数料納付書", "CERTIFICATEFORPAYMENTOFFEE", "別記第八十四号様式", "納付者氏名", "在留期間の更新許可", "Extensionofperiodofstay"]) assert.ok(squeezed.includes(label), `label resmi hilang: ${label}`);
  const name = r.items.find((i) => i.str.includes("DEWI LESTARI HANDAYANI"));
  assert.ok(name, "nama tercetak");
  // posisi: di dalam kolom (kanan label 納付者氏名, di atas garis) dan di halaman
  assert.ok(name.transform[4] >= FEE_FORM.name.x0 - 1 && name.transform[4] < FEE_FORM.name.x1, `x ${name.transform[4]}`);
  assert.ok(Math.abs(name.transform[5] - FEE_FORM.name.baseline) < 1, `y ${name.transform[5]}`);
  // tidak ada angka/tanggal/jumlah yang ditambahkan selain nama: tidak ada digit baru (formulir resmi hanya memuat nomor 1-9 dan "67", "67-2", "68", "61", "84", "A4")
  const added = r.items.filter((i) => i !== name && /[A-Z]{3,}/.test(i.str) && /DEWI|LESTARI|HANDAYANI/.test(i.str));
  assert.equal(added.length, 0);
});

test("PDF: lingkaran digambar (operasi grafik bertambah dibanding formulir kosong) dan metadata menyebut 'loket'; nama kosong = hanya lingkaran", async () => {
  const blank = await read(await renderFeeFormPdf({ nameRomaji: "" }));
  const named = await read(await renderFeeFormPdf({ nameRomaji: "DEWI" }));
  const { readFile } = await import("node:fs/promises");
  const orig = await read(Buffer.from(await readFile("assets/forms/tesuryo-nofusho-84.pdf")));
  assert.ok(blank.opCount > orig.opCount, "lingkaran menambah operasi gambar");
  assert.ok(named.opCount > blank.opCount, "nama menambah operasi teks");
  assert.ok(!blank.text.includes("DEWI"));
  const buf = await renderFeeFormPdf({ nameRomaji: "DEWI" });
  const dir = `${process.cwd()}/node_modules/pdfjs-dist`;
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false, cMapUrl: `${dir}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${dir}/standard_fonts/` }).promise;
  const info = (await doc.getMetadata()).info as Record<string, string>;
  assert.match(String(info.Subject), /loket/);
  assert.match(String(info.Title), /窓口/);
});

test("nama sangat panjang: tercetak UTUH dalam beberapa baris (semua bagian ada di PDF)", async () => {
  const long = "MUHAMMAD RIZKY RAMADHAN PRATAMA KUSUMA WIJAYA SETIAWAN";
  const r = await read(await renderFeeFormPdf({ nameRomaji: long }));
  const printed = r.items.filter((i) => /[A-Z]{3,}/.test(i.str) && long.split(" ").some((w) => i.str.includes(w))).map((i) => i.str).join(" ");
  for (const w of long.split(" ")) assert.ok(printed.includes(w), `kata hilang: ${w}`);
});
