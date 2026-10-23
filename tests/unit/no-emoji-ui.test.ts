import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// T-036: ikon antarmuka memakai `Icon` (ikon garis), bukan emoji; panah tidak ditempel di teks tombol/tautan.
// Tanda tipografi (✓ ✗ ● ← →  di tengah kalimat, mis. "dari → ke") tetap boleh: hanya piktograf emoji dan panah di UJUNG label yang ditolak.
const ROOT = join(import.meta.dirname, "..", "..");
const PICTO = /\p{Extended_Pictographic}/u;
// "→" tepat sebelum tag penutup tautan/tombol, atau sesudah ekspresi `{…}` di ujung isi elemen.
const ARROW_END = /→\s*(<\/(Link|a|button)>|$)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) ? [p] : [];
  });
}
// © ® ™ termasuk Extended_Pictographic di Unicode, tetapi tanda teks biasa (mis. "© Hashi" di login).
const TEXT_MARKS = new Set(["©", "®", "™"]);
const findEmoji = (src: string) => [...src].filter((ch) => PICTO.test(ch) && !TEXT_MARKS.has(ch));
const findArrow = (src: string) => src.split("\n").filter((l) => ARROW_END.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"));

test("tidak ada emoji di komponen dan katalog pesan (ikon lewat <Icon>)", () => {
  const targets = [...files(join(ROOT, "src")), join(ROOT, "messages", "id.json"), join(ROOT, "messages", "ja.json")];
  const bad = targets.flatMap((f) => findEmoji(readFileSync(f, "utf8")).map((c) => `${relative(ROOT, f)}: ${c}`));
  assert.deepEqual(bad, []);
});

test("tidak ada panah '→' yang ditempel di ujung label tautan/tombol", () => {
  const bad = files(join(ROOT, "src")).flatMap((f) => findArrow(readFileSync(f, "utf8")).map((l) => `${relative(ROOT, f)}: ${l.trim().slice(0, 100)}`));
  assert.deepEqual(bad, []);
});

test("penjaga menangkap contoh dan membiarkan tanda tipografi", () => {
  assert.deepEqual(findEmoji("selesai ✅ ⚠ 🎉"), ["✅", "⚠", "🎉"]);
  assert.deepEqual(findEmoji("✓ selesai ● terbuka ✗ belum, dari → ke, © Hashi"), []);
  assert.equal(findArrow(`<Link href="/x">{t("next")} →</Link>`).length, 1);
  assert.equal(findArrow(`<span>{from}{" → "}{to}</span>`).length, 0);
});
