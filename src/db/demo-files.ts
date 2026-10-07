// Berkas dokumen DUMMY untuk seed demo, dan pembersihan storage saat --reset.
// Tata letak sama dengan unggahan asli (src/features/documents/storage.ts): <STORAGE_DIR>/<org_id>/<candidate_id>/<document_id>.<ext>.
// Script tidak boleh mengimpor dari src/features, jadi tata letak itu ditulis ulang di sini (dijaga e2e: unduh dokumen seed).
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function storageRootFor(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.STORAGE_DIR || "docs-data");
}

export function demoDocumentPath(root: string, orgId: string, candidateId: string, documentId: string, ext: "pdf" | "png" | "jpg"): string {
  if (![orgId, candidateId, documentId].every((v) => UUID.test(v))) throw new Error("id dokumen tidak valid");
  return path.join(root, orgId, candidateId, `${documentId}.${ext}`);
}

/** Lampiran catatan kegiatan: <STORAGE_DIR>/activity/<org_id>/<attachment_id>.<ext> (sama dengan src/features/records/images.ts). */
export function demoAttachmentPath(root: string, orgId: string, attachmentId: string, ext: "png" | "jpg" | "webp"): string {
  if (![orgId, attachmentId].every((v) => UUID.test(v))) throw new Error("id lampiran tidak valid");
  return path.join(root, "activity", orgId, `${attachmentId}.${ext}`);
}

export async function writeDemoFile(file: string, data: Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  await writeFile(file, data, { mode: 0o640 });
}

/**
 * Hapus berkas dokumen lama sebelum --reset: HANYA folder berawalan UUID (folder organisasi) di dalam storage, apa pun
 * isi lainnya dibiarkan, supaya STORAGE_DIR yang salah arah tidak menghapus file lain. Mengembalikan jumlah folder dihapus.
 */
export async function clearDocumentStorage(root: string): Promise<number> {
  let removed = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  for (const e of entries) {
    if (e.isDirectory() && (UUID.test(e.name) || e.name === "activity" || e.name === "cards")) {
      await rm(path.join(root, e.name), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

/** PDF satu halaman yang sah (xref dihitung), bertuliskan DUMMY dan jenis dokumen. Karakter non-ASCII dibuang. */
export function dummyPdf(label: string): Buffer {
  const text = `DUMMY - ${label}`.replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "");
  const stream = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET\nBT /F1 12 Tf 72 660 Td (Berkas contoh untuk demo Hashi. Bukan dokumen asli.) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG sederhana 120x150 (rasio pas foto): latar gradasi dengan siluet kepala dan bahu. */
export function dummyPng(): Buffer {
  const w = 120;
  const h = 150;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      let r = 190 + Math.round((y / h) * 30);
      let g = 205 + Math.round((y / h) * 20);
      let b = 225;
      const head = (x - 60) ** 2 + (y - 55) ** 2 < 28 ** 2;
      const body = y > 95 && (x - 60) ** 2 / 55 ** 2 + (y - 150) ** 2 / 55 ** 2 < 1;
      if (head || body) [r, g, b] = [120, 130, 150];
      const o = row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
