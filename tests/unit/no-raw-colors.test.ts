import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// T-033: warna UI hanya lewat token `@theme` di globals.css, supaya mengganti palet cukup di satu tempat (T-034).
// Pemindai sumber: kelas warna Tailwind mentah (`text-stone-500`, `bg-rose-50/40`, ...) dilarang di seluruh src/;
// warna heks di komponen (.tsx) hanya boleh di components/brand/ (aset merek). PDF (src/lib/pdf) dan email (src/db) bukan UI web.
const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "src");

const RAW_CLASS =
  /\b(bg|text|border|ring|divide|outline|fill|stroke|from|via|to|accent|caret|decoration|placeholder|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
// Kelas arbitrer berwarna (`text-[#E6EAFF]`) dan atribut SVG berwarna heks (`fill="#6B645B"`).
const HEX_IN_TSX = /-\[#[0-9a-fA-F]{3,8}\]|\b(fill|stroke|color)="#[0-9a-fA-F]{3,8}"/g;
const HEX_ALLOWED = ["src/components/brand/"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

function findRaw(src: string): string[] {
  return [...src.matchAll(RAW_CLASS)].map((m) => m[0]);
}
function findHex(src: string): string[] {
  return [...src.matchAll(HEX_IN_TSX)].map((m) => m[0]);
}

test("tidak ada kelas warna Tailwind mentah di src/", () => {
  const bad = files(SRC).flatMap((f) => findRaw(readFileSync(f, "utf8")).map((m) => `${relative(ROOT, f)}: ${m}`));
  assert.deepEqual(bad, [], `pakai token dari globals.css (@theme):\n${bad.join("\n")}`);
});

test("tidak ada warna heks di komponen kecuali aset merek", () => {
  const bad = files(SRC)
    .filter((f) => f.endsWith(".tsx") && !HEX_ALLOWED.some((a) => relative(ROOT, f).startsWith(a)))
    .flatMap((f) => findHex(readFileSync(f, "utf8")).map((m) => `${relative(ROOT, f)}: ${m}`));
  assert.deepEqual(bad, [], `pakai token (kelas atau var(--color-…)):\n${bad.join("\n")}`);
});

test("penjaga menangkap contoh yang disisipkan dan tidak salah tangkap token", () => {
  assert.deepEqual(findRaw(`className="text-stone-500 hover:bg-rose-50/40 divide-stone-100"`), ["text-stone-500", "bg-rose-50", "divide-stone-100"]);
  assert.deepEqual(findRaw(`className="text-ink-2 bg-danger-bg border-line-soft bg-brand-600 text-status-done-text"`), []);
  assert.deepEqual(findHex(`<li className="text-[#E6EAFF]"><svg stroke="#C9D3FF" /></li>`), ["-[#E6EAFF]", 'stroke="#C9D3FF"']);
  assert.deepEqual(findHex(`<line style={{ stroke: "var(--color-line)" }} />`), []);
});

// ---- Kontras: pasangan teks/latar yang benar-benar dipakai komponen, dibaca dari token globals.css ----

function tokens(): Record<string, string> {
  const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
  const theme = css.slice(css.indexOf("@theme"), css.indexOf("}", css.indexOf("@theme")));
  return Object.fromEntries([...theme.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [teks, latar]; "white" = teks putih di atas tombol berwarna penuh.
const PAIRS: [string, string][] = [
  ["ink", "page"], ["ink", "card"], ["ink-2", "page"], ["ink-2", "card"], ["ink-menu", "card"],
  ["ink", "muted"], ["ink-menu", "muted-strong"], ["ink-2", "muted"],
  ["white", "accent"], ["white", "accent-dark"], ["accent-text", "accent-soft"],
  ["danger-text", "danger-bg"], ["danger-text", "card"], ["white", "danger-solid"], ["white", "danger-solid-hover"],
  ["warn-text", "warn-bg"], ["warn-text", "warn-bg-strong"], ["warn-text", "card"],
  ["ok-text", "ok-bg"], ["info-text", "info-bg"], ["attn-text", "attn-bg"],
  ["status-shortlist-text", "status-shortlist-bg"], ["status-interview-text", "status-interview-bg"],
  ["status-docs-text", "status-docs-bg"], ["status-done-text", "status-done-bg"],
  ["brand-mist", "brand-navy"],
];

test("kontras teks token >= 4,5:1 (WCAG AA)", () => {
  const t: Record<string, string> = { ...tokens(), white: "#ffffff" };
  const bad = PAIRS.flatMap(([fg, bg]) => {
    assert.ok(t[fg] && t[bg], `token tidak ada: ${t[fg] ? bg : fg}`);
    const c = contrast(t[fg], t[bg]);
    return c >= 4.5 ? [] : [`${fg} di atas ${bg}: ${c.toFixed(2)}:1`];
  });
  assert.deepEqual(bad, []);
});
