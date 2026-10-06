// Pembangun PDF bersama (langkah 7A; dipakai lagi lembar klien langkah 6). pdfkit murni JavaScript: TANPA browser headless, jalan di image produksi.
// Font Noto Sans JP (OFL, assets/fonts) disematkan (subset) ke PDF. A4, header organisasi, footer tanggal pembuatan + "n / N".
import path from "node:path";
import PDFDocument from "pdfkit";
import { PDF } from "./labels.ja";

type Doc = InstanceType<typeof PDFDocument>;

export function fontPath(weight: "Regular" | "Bold"): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), "assets", "fonts", `NotoSansJP-${weight}.ttf`);
}

const M = { left: 40, right: 40, top: 62, bottom: 56 };
const PAD = 5;
const INK = "#1F1B16";
const MUTED = "#6B645B";
const LINE = "#CFC8BE";
const SHADE = "#F1ECE5";

export type Col = { header: string; width: number };

export class PdfBuilder {
  readonly doc: Doc;
  private chunks: Buffer[] = [];
  private done: Promise<Buffer>;

  constructor(private meta: { orgName: string; headerRight: string; createdAt: string; title: string }) {
    this.doc = new PDFDocument({ size: "A4", margins: { ...M }, bufferPages: true, font: fontPath("Regular"), info: { Title: meta.title, Creator: "Hashi", Producer: "Hashi" } });
    this.doc.registerFont("Regular", fontPath("Regular"));
    this.doc.registerFont("Bold", fontPath("Bold"));
    this.done = new Promise((resolve, reject) => {
      this.doc.on("data", (c: Buffer) => this.chunks.push(c));
      this.doc.on("end", () => resolve(Buffer.concat(this.chunks)));
      this.doc.on("error", reject);
    });
  }

  /** Jumlah halaman sejauh ini (setelah semua isi digambar, sebelum finish()): untuk audit ekspor. */
  get pageCount() {
    return this.doc.bufferedPageRange().count;
  }

  get width() {
    return this.doc.page.width - M.left - M.right;
  }
  private get bottomY() {
    return this.doc.page.height - M.bottom;
  }

  private ensure(h: number) {
    if (this.doc.y + h > this.bottomY) this.doc.addPage();
  }

  title(text: string, sub?: string) {
    this.doc.font("Bold").fontSize(16).fillColor(INK).text(text, M.left, this.doc.y, { width: this.width });
    if (sub) this.doc.font("Regular").fontSize(9.5).fillColor(MUTED).text(sub, { width: this.width });
    this.doc.moveDown(0.6);
  }

  h2(text: string) {
    this.ensure(40);
    this.doc.moveDown(0.4).font("Bold").fontSize(11.5).fillColor(INK).text(text, M.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.25);
  }

  banner(text: string) {
    const h = this.doc.font("Bold").fontSize(10).heightOfString(text, { width: this.width - 2 * PAD }) + 2 * PAD;
    this.ensure(h + 6);
    const y = this.doc.y;
    this.doc.rect(M.left, y, this.width, h).fill("#FBE9E7");
    this.doc.fillColor("#8A1C12").text(text, M.left + PAD, y + PAD, { width: this.width - 2 * PAD });
    this.doc.y = y + h + 6;
    this.doc.x = M.left;
  }

  para(text: string, opts: { size?: number; color?: string; bold?: boolean } = {}) {
    this.doc.font(opts.bold ? "Bold" : "Regular").fontSize(opts.size ?? 10).fillColor(opts.color ?? INK).text(text, M.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.3);
  }

  /** Tabel dua kolom label/nilai (① dan kepala ②/③/④). Nilai ber-baris-baru dicetak apa adanya. */
  kv(rows: Array<[string, string]>, labelWidth = 120) {
    const vw = this.width - labelWidth;
    for (const [label, value] of rows) {
      const v = value || PDF.common.none;
      this.doc.font("Regular").fontSize(9.5);
      const h = Math.max(this.doc.heightOfString(v, { width: vw - 2 * PAD }), this.doc.heightOfString(label, { width: labelWidth - 2 * PAD })) + 2 * PAD;
      const hh = Math.min(h, this.bottomY - M.top - 4);
      this.ensure(hh);
      const y = this.doc.y;
      this.doc.rect(M.left, y, labelWidth, hh).fillAndStroke(SHADE, LINE);
      this.doc.rect(M.left + labelWidth, y, vw, hh).stroke(LINE);
      this.doc.fillColor(INK).font("Bold").fontSize(9.5).text(label, M.left + PAD, y + PAD, { width: labelWidth - 2 * PAD, height: hh - 2 * PAD });
      this.doc.font("Regular").text(v, M.left + labelWidth + PAD, y + PAD, { width: vw - 2 * PAD, height: hh - 2 * PAD });
      this.doc.y = y + hh;
      this.doc.x = M.left;
    }
    this.doc.moveDown(0.5);
  }

  /** Tabel banyak kolom dengan kepala berulang di tiap halaman. `rows[i].shade` = latar baris (mis. ringkasan kuartal). */
  table(cols: Col[], rows: Array<{ cells: string[]; muted?: boolean; shade?: boolean; span?: boolean }>) {
    const total = cols.reduce((n, c) => n + c.width, 0);
    const scale = this.width / total;
    const widths = cols.map((c) => c.width * scale);
    const header = () => {
      this.doc.font("Bold").fontSize(9);
      const h = Math.max(...cols.map((c, i) => this.doc.heightOfString(c.header, { width: widths[i] - 2 * PAD }))) + 2 * PAD;
      this.ensure(h + 30);
      const y = this.doc.y;
      let x = M.left;
      cols.forEach((c, i) => {
        this.doc.rect(x, y, widths[i], h).fillAndStroke(SHADE, LINE);
        this.doc.fillColor(INK).text(c.header, x + PAD, y + PAD, { width: widths[i] - 2 * PAD });
        x += widths[i];
      });
      this.doc.y = y + h;
      this.doc.x = M.left;
    };
    header();
    for (const row of rows) {
      this.doc.font("Regular").fontSize(9);
      let h: number;
      if (row.span) h = this.doc.heightOfString(row.cells[0], { width: this.width - 2 * PAD }) + 2 * PAD;
      else h = Math.max(...row.cells.map((c, i) => this.doc.heightOfString(c || " ", { width: widths[i] - 2 * PAD }))) + 2 * PAD;
      h = Math.min(h, this.bottomY - M.top - 40);
      if (this.doc.y + h > this.bottomY) {
        this.doc.addPage();
        header();
      }
      const y = this.doc.y;
      if (row.span) {
        this.doc.rect(M.left, y, this.width, h).fillAndStroke(row.shade ? SHADE : "#FFFFFF", LINE);
        this.doc.fillColor(row.muted ? MUTED : INK).text(row.cells[0], M.left + PAD, y + PAD, { width: this.width - 2 * PAD, height: h - 2 * PAD });
      } else {
        let x = M.left;
        row.cells.forEach((c, i) => {
          this.doc.rect(x, y, widths[i], h).fillAndStroke(row.shade ? SHADE : "#FFFFFF", LINE);
          this.doc.fillColor(row.muted ? MUTED : INK).text(c, x + PAD, y + PAD, { width: widths[i] - 2 * PAD, height: h - 2 * PAD });
          x += widths[i];
        });
      }
      this.doc.y = y + h;
      this.doc.x = M.left;
    }
    this.doc.moveDown(0.5);
  }

  /** Gambar (JPEG/PNG) dengan keterangan, lebar maksimum 260pt. */
  image(data: Buffer, caption: string | null) {
    const maxW = Math.min(260, this.width);
    const maxH = 200;
    this.ensure(maxH + 30);
    const y = this.doc.y;
    this.doc.image(data, M.left, y, { fit: [maxW, maxH] });
    this.doc.y = y + maxH + 4;
    if (caption) this.doc.font("Regular").fontSize(8.5).fillColor(MUTED).text(caption, M.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.6);
  }

  async finish(): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      this.doc.switchToPage(range.start + i);
      const p = this.doc.page;
      const saved = p.margins.bottom;
      p.margins.bottom = 0; // supaya teks di zona footer tidak memicu halaman baru
      this.doc.font("Regular").fontSize(8.5).fillColor(MUTED);
      this.doc.text(this.meta.orgName, M.left, 28, { width: this.width / 2, lineBreak: false });
      this.doc.text(this.meta.headerRight, M.left + this.width / 2, 28, { width: this.width / 2, align: "right", lineBreak: false });
      this.doc.moveTo(M.left, 44).lineTo(M.left + this.width, 44).lineWidth(0.5).stroke(LINE);
      this.doc.text(`${PDF.common.createdAt}: ${this.meta.createdAt}`, M.left, p.height - 34, { width: this.width / 2, lineBreak: false });
      this.doc.text(PDF.common.page(i + 1, range.count), M.left + this.width / 2, p.height - 34, { width: this.width / 2, align: "right", lineBreak: false });
      p.margins.bottom = saved;
    }
    this.doc.end();
    return this.done;
  }
}

export { jaDateTime, jaDay } from "./dates";
