// Membangun aset merek turunan dari design/brand-source/ (berkas sumber HANYA dibaca) ke public/brand/, src/app/ (file metadata Next.js) dan public/icons/.
// Bisa diulang (hasil sama). Pemakaian: npm run build:brand . Hasilnya di-commit.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";

const SRC = "design/brand-source";
const src = (n: string) => path.join(SRC, n);
const out = async (file: string, buf: Buffer) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  console.log("✓", file, `${buf.length} B`);
};
const png = (img: Sharp) => img.png({ compressionLevel: 9 }).toBuffer();

/** Potong bantalan kosong (warna latar = piksel pojok kiri atas); warna tidak diubah. */
const trimmed = (file: string) => sharp(src(file)).trim({ threshold: 8 });

async function main() {
  // Logo penuh: lebar 640 dan 1280 (@2x)
  for (const tone of ["light", "dark"] as const) {
    const f = `hashi-logo-${tone}.png`;
    await out(`public/brand/logo-${tone}.png`, await png(trimmed(f).resize({ width: 640 })));
    await out(`public/brand/logo-${tone}@2x.png`, await png(trimmed(f).resize({ width: 1280 })));
  }
  // Simbol saja: 96, 192, 384 (tinggi = lebar setelah dipangkas bersegi). mark-dark opak navy: pakai hanya di atas #0F1424.
  for (const tone of ["light", "dark"] as const) {
    const t = await png(trimmed(`hashi-icon-${tone}.png`));
    const { width, height } = await sharp(t).metadata();
    const side = Math.max(width!, height!);
    const bg = tone === "dark" ? { r: 15, g: 20, b: 36, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
    const square = await png(sharp(t).extend({ top: Math.floor((side - height!) / 2), bottom: Math.ceil((side - height!) / 2), left: Math.floor((side - width!) / 2), right: Math.ceil((side - width!) / 2), background: bg }));
    for (const s of [96, 192, 384]) await out(`public/brand/mark-${tone}-${s}.png`, await png(sharp(square).resize(s, s)));
  }
  // Icon situs (konvensi file metadata App Router)
  const rounded = src("hashi-icon-app-rounded.png");
  await out("src/app/icon.png", await png(sharp(rounded).resize(512, 512)));
  await out("src/app/apple-icon.png", await png(sharp(src("hashi-icon-dark.png")).resize(180, 180))); // iOS: penuh sampai tepi, opak
  await out("public/icons/icon-192.png", await png(sharp(rounded).resize(192, 192)));
  await out("public/icons/icon-512.png", await png(sharp(rounded).resize(512, 512)));
  // favicon.ico: berisi PNG 16, 32, 48 (format ICO modern)
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map((s) => png(sharp(rounded).resize(s, s))));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const o = 6 + 16 * i;
    head[o] = s; head[o + 1] = s; head[o + 2] = 0; head[o + 3] = 0;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(pngs[i].length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  await out("src/app/favicon.ico", Buffer.concat([head, ...pngs]));
}
main().catch((e) => { console.error(e); process.exit(1); });
