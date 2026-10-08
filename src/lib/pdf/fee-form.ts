// 手数料納付書 (別記第八十四号様式) untuk pengajuan di LOKET (T-026): latar = PDF kosong RESMI 出入国在留管理庁 (assets/forms/tesuryo-nofusho-84.pdf, dipakai apa adanya),
// ditambah SATU hal: nama pekerja (romaji huruf besar) di kolom 納付者氏名 dan lingkaran pada nomor 2 (在留期間の更新許可). Tanggal, nomor, jumlah uang, dan 収入印紙 dibiarkan kosong
// (diisi di loket / ditempel manual). Hanya untuk loket: pengajuan ONLINE sejak 2026-10-01 membayar via konbini/bank tanpa formulir ini.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/** Koordinat dalam poin PDF (asal kiri-BAWAH), diukur dari formulir resmi (pdftotext -bbox + render 100 dpi). A4 = 595.276 × 841.89. */
export const FEE_FORM = {
  page: { w: 595.276, h: 841.89 },
  /** Lingkaran pada nomor "2": pusat digit "2" (x 152.6-158.0, y atas 426.1-436.9) → pusat (155.3, 410.4) dari bawah. */
  circle2: { cx: 155.34, cy: 410.4, rx: 9.5, ry: 9.5, borderWidth: 1.3 },
  /** Kolom 納付者氏名: garis x 406-528 pt, garis di y 151.3 dari bawah; teks duduk 2,5 pt di atas garis. */
  name: { x0: 408, x1: 526, baseline: 153.8, maxSize: 11, minSize: 7.5, lineGap: 9 },
} as const;

/** Berkas latar resmi (process.cwd() = /app di image; sama dengan font di src/lib/pdf/core.ts). */
export const feeFormTemplatePath = () => path.resolve(/* turbopackIgnore: true */ process.cwd(), "assets", "forms", "tesuryo-nofusho-84.pdf");

export type NameLayout = { lines: string[]; size: number };

/**
 * Tata letak nama di kolom: satu baris dengan ukuran sebesar mungkin (<= maxSize) sampai muat; bila di minSize tetap tidak muat, dibungkus per KATA ke beberapa baris di ukuran minSize
 * (baris terakhir duduk di atas garis, baris sebelumnya naik; ruang di atas kolom kosong). Nama TIDAK PERNAH dipotong (nama resmi harus utuh); hanya satu kata yang lebih lebar dari kolom
 * dipotong sebagai jaring pengaman. `width(text, size)` = pengukur lebar (disuntik supaya murni dan bisa dites).
 */
export function layoutName(name: string, width: (t: string, size: number) => number, maxWidth: number = FEE_FORM.name.x1 - FEE_FORM.name.x0, maxSize: number = FEE_FORM.name.maxSize, minSize: number = FEE_FORM.name.minSize): NameLayout {
  const clean = name.replace(/\s+/g, " ").trim();
  for (let size = maxSize; size >= minSize - 1e-9; size -= 0.5) if (width(clean, size) <= maxWidth) return { lines: [clean], size };
  const lines: string[] = [];
  let cur = "";
  for (const raw of clean.split(" ")) {
    const word = fit(raw, width, maxWidth, minSize);
    const next = cur ? `${cur} ${word}` : word;
    if (cur && width(next, minSize) > maxWidth) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return { lines, size: minSize };
}

/** Potong dari belakang sampai muat (jaring pengaman untuk SATU kata yang lebih lebar dari kolom). */
function fit(text: string, width: (t: string, size: number) => number, maxWidth: number, size: number): string {
  let t = text;
  while (t.length > 1 && width(t, size) > maxWidth) t = t.slice(0, -1);
  return t;
}

/** Teks yang boleh dicetak di kolom: huruf Latin kapital, spasi, tanda hubung, apostrof (WinAnsi aman). */
export const feeFormName = (romaji: string): string => romaji.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z' .-]/g, " ").replace(/\s+/g, " ").trim();

export async function renderFeeFormPdf(opts: { nameRomaji: string; templateBytes?: Uint8Array }): Promise<Buffer> {
  const bytes = opts.templateBytes ?? (await readFile(feeFormTemplatePath()));
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const font: PDFFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.05, 0.05);

  const c = FEE_FORM.circle2;
  page.drawEllipse({ x: c.cx, y: c.cy, xScale: c.rx, yScale: c.ry, borderWidth: c.borderWidth, borderColor: ink });

  const name = feeFormName(opts.nameRomaji);
  if (name) {
    const lay = layoutName(name, (t, s) => font.widthOfTextAtSize(t, s));
    const n = FEE_FORM.name;
    lay.lines.forEach((line, k) => page.drawText(line, { x: n.x0, y: n.baseline + (lay.lines.length - 1 - k) * n.lineGap, size: lay.size, font, color: ink }));
  }

  doc.setTitle("手数料納付書 (窓口申請用) / Certificate for payment of fee (counter filing only)");
  doc.setSubject("Dibuat Hashi: HANYA untuk pengajuan di loket. Pengajuan online membayar via konbini/bank (tanpa formulir ini).");
  doc.setProducer("Hashi");
  doc.setCreator("Hashi");
  return Buffer.from(await doc.save());
}
