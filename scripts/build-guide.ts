// Buku panduan (T-030): docs/panduan/README.md -> docs/panduan/panduan-hashi.pdf (A4, sampul, daftar isi dengan nomor halaman, gambar ikut, nomor halaman di kaki).
// `npm run build:guide`. Markdown -> HTML (marked) -> PDF (Chromium dari Playwright yang sudah ada). Dua putaran: putaran 1 mencari halaman tiap judul (pdfjs),
// putaran 2 mengisi nomor ke daftar isi (lebar nomor tetap, jadi tata letak tidak bergeser). Tidak memakai jaringan dan tidak menyentuh database.
// Gambar dibuat terpisah oleh `npm run guide:shots` (tangkapan layar otomatis, hanya database dev).
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { marked } from "marked";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DIR = path.resolve("docs/panduan");
const SRC = path.join(DIR, "README.md");
const OUT = path.join(DIR, "panduan-hashi.pdf");
const TMP = path.join(DIR, ".guide-build.html");

type TocEntry = { depth: 2 | 3; text: string; id: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markdown -> HTML isi + daftar judul (## dan ###). */
function render(md: string): { html: string; toc: TocEntry[]; title: string; lead: string } {
  const toc: TocEntry[] = [];
  let n = 0;
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.startsWith("# "));
  const title = lines[first].slice(2).trim();
  const afterTitle = lines.slice(first + 1);
  const firstH2 = afterTitle.findIndex((l) => l.startsWith("## "));
  const lead = afterTitle.slice(0, firstH2).join("\n").trim();
  const body = afterTitle.slice(firstH2).join("\n");
  marked.use({
    renderer: {
      heading(token) {
        const text = token.tokens.map((t) => ("text" in t ? String(t.text) : "")).join("");
        const inner = this.parser.parseInline(token.tokens);
        if (token.depth === 2 || token.depth === 3) {
          const id = `h${++n}`;
          toc.push({ depth: token.depth, text, id });
          return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
        }
        return `<h${token.depth}>${inner}</h${token.depth}>\n`;
      },
      image(token) {
        return `<figure><img src="${esc(token.href)}" alt="${esc(token.text)}"><figcaption>${esc(token.text)}</figcaption></figure>`;
      },
      paragraph(token) {
        // paragraf yang hanya berisi gambar: jangan dibungkus <p> (figure tidak boleh di dalam p)
        if (token.tokens.length === 1 && token.tokens[0].type === "image") return this.parser.parseInline(token.tokens);
        return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
      },
      link(token) {
        const inner = this.parser.parseInline(token.tokens);
        // tautan ke berkas repo tidak berguna di PDF: tampilkan teksnya saja
        return /^(https?:|#)/.test(token.href) ? `<a href="${esc(token.href)}">${inner}</a>` : `<span class="ref">${inner}</span>`;
      },
    },
  });
  const html = marked.parse(body, { async: false }) as string;
  return { html, toc, title, lead: marked.parseInline(lead, { async: false }) as string };
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.55 "Noto Sans", "Noto Sans JP", "DejaVu Sans", system-ui, sans-serif; color: #1c1917; margin: 0; }
h1, h2, h3 { line-height: 1.25; color: #111; }
h2 { font-size: 20pt; margin: 0 0 8mm; padding-bottom: 3mm; border-bottom: 3px solid #c2410c; break-before: page; }
h3 { font-size: 13.5pt; margin: 9mm 0 3mm; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
p { margin: 0 0 3mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin: 0 0 1.5mm; }
code { background: #f3f0ea; border-radius: 3px; padding: 0 1.2mm; font: 9.5pt "DejaVu Sans Mono", monospace; }
blockquote { margin: 0 0 3mm; padding: 2.5mm 4mm; background: #fff7ed; border-left: 3px solid #c2410c; }
blockquote p { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 4mm; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #d6d3d1; padding: 1.6mm 2.4mm; text-align: left; vertical-align: top; }
th { background: #f5f0e8; }
figure { margin: 3mm 0 5mm; break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 215mm; border: 1px solid #d6d3d1; border-radius: 4px; }
figcaption { font-size: 8.5pt; color: #57534e; margin-top: 1.5mm; }
ol > li > figure, ul > li > figure { margin-left: 0; }
.ref { color: #57534e; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover .mark { font-size: 12pt; font-weight: 700; color: #c2410c; letter-spacing: .08em; text-transform: uppercase; }
.cover h1 { font-size: 36pt; margin: 4mm 0 8mm; }
.cover p { font-size: 13pt; max-width: 140mm; color: #44403c; }
.cover .meta { margin-top: 24mm; font-size: 9.5pt; color: #78716c; }
.toc { break-before: page; }
.toc h2 { break-before: auto; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { display: flex; gap: 2mm; margin: 0; padding: 0.6mm 0; }
.toc li.l2 { margin-top: 2.5mm; font-weight: 700; }
.toc li.l3 { padding-left: 6mm; font-size: 10pt; }
.toc .dots { flex: 1; border-bottom: 1px dotted #a8a29e; transform: translateY(-1.2mm); }
.toc .pg { min-width: 7mm; text-align: right; font-variant-numeric: tabular-nums; }
.toc a { color: inherit; text-decoration: none; }
`;

function page(opts: { title: string; lead: string; toc: TocEntry[]; body: string; pages: Map<string, number> | null; date: string }) {
  const li = opts.toc
    .map((e) => {
      const n = opts.pages?.get(e.id);
      return `<li class="l${e.depth}"><a href="#${e.id}">${esc(e.text)}</a><span class="dots"></span><span class="pg">${n === undefined ? "00" : String(n).padStart(2, "0")}</span></li>`;
    })
    .join("\n");
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>${CSS}</style></head><body>
<section class="cover"><div class="mark">Hashi 橋</div><h1>${esc(opts.title)}</h1><p>${opts.lead}</p><div class="meta">Versi ${opts.date} · semua contoh memakai data dummy</div></section>
<section class="toc"><h2>Daftar isi</h2><ol>${li}</ol></section>
${opts.body}
</body></html>`;
}

async function pdfPages(buf: Buffer): Promise<string[]> {
  const dir = `${process.cwd()}/node_modules/pdfjs-dist`;
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false, cMapUrl: `${dir}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${dir}/standard_fonts/` }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " "));
  }
  return out;
}

/** Halaman (1-indeks) tempat tiap judul tampil di ISI (kemunculan terakhir: daftar isi ada sebelum isi). */
function locate(toc: TocEntry[], texts: string[]): Map<string, number> {
  const norm = (s: string) => s.replace(/\s+/g, ""); // tanpa spasi: pdfjs kadang memecah/menggabung kata pada batas item teks
  const map = new Map<string, number>();
  for (const e of toc) {
    const needle = norm(e.text);
    let found = 0;
    texts.forEach((t, i) => {
      if (norm(t).includes(needle)) found = i + 1;
    });
    if (!found) throw new Error(`judul tidak ditemukan di PDF: ${e.text}`);
    map.set(e.id, found);
  }
  return map;
}

/** Setiap gambar yang dirujuk harus ada; gambar yang tidak dirujuk dilaporkan (jangan ada gambar yatim di repo). */
function checkImages(html: string) {
  const used = new Set([...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...used].filter((u) => !existsSync(path.join(DIR, u)));
  if (missing.length) throw new Error(`gambar tidak ada: ${missing.join(", ")} (jalankan npm run guide:shots)`);
  const orphan = readdirSync(path.join(DIR, "img")).filter((f) => f.endsWith(".png") && !used.has(`img/${f}`));
  if (orphan.length) throw new Error(`gambar tidak dipakai di panduan: ${orphan.join(", ")}`);
}

async function main() {
  const { html, toc, title, lead } = render(readFileSync(SRC, "utf8"));
  checkImages(html);
  const date = new Date().toISOString().slice(0, 10);
  const browser = await chromium.launch({ args: ["--lang=id-ID"], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
  try {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    const make = async (pages: Map<string, number> | null) => {
      writeFileSync(TMP, page({ title, lead, toc, body: html, pages, date }));
      await pg.goto(`file://${TMP}`);
      await pg.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
      return Buffer.from(
        await pg.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#78716c"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
          margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
        }),
      );
    };
    let pages = locate(toc, await pdfPages(await make(null)));
    let pdf = await make(pages);
    const again = locate(toc, await pdfPages(pdf));
    if (JSON.stringify([...again]) !== JSON.stringify([...pages])) {
      pages = again;
      pdf = await make(pages);
    }
    writeFileSync(OUT, pdf);
    const count = (await pdfPages(pdf)).length;
    console.log(`✓ ${path.relative(process.cwd(), OUT)}: ${count} halaman, ${(statSync(OUT).size / 1024 / 1024).toFixed(2)} MB, ${(html.match(/<figure>/g) ?? []).length} gambar`);
  } finally {
    await browser.close();
    rmSync(TMP, { force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
