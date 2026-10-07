import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// T-013: JANGAN Promise.all pada `tx` (kueri bersamaan di satu koneksi pg = peringatan "already executing a query"; pg@9: error). Pakai inSeries (src/db/serial.ts).
// Pemindai sumber: setiap `Promise.all(` yang isinya memakai `tx` DI LUAR tenantQuery/withTenant/withSystem (transaksi sendiri-sendiri) gagal.
const ROOT = join(import.meta.dirname, "..", "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
/** Isi (dalam kurung) dari pembuka pada indeks `open` yang menunjuk '('; mengabaikan string. */
function balanced(src: string, open: number): { body: string; end: number } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
  }
  return { body: src.slice(open + 1), end: src.length };
}
/** Buang pemanggilan yang membuka transaksi SENDIRI (tx di dalamnya tidak dipakai bersama). */
function stripOwnTx(body: string): string {
  let out = body;
  for (const fn of ["tenantQuery", "withTenant", "withSystem"]) {
    for (;;) {
      const i = out.indexOf(`${fn}(`);
      if (i < 0) break;
      const { end } = balanced(out, i + fn.length);
      out = out.slice(0, i) + out.slice(end);
    }
  }
  return out;
}

export function findTxPromiseAll(src: string): number[] {
  const hits: number[] = [];
  for (const m of src.matchAll(/Promise\.all\(/g)) {
    const { body } = balanced(src, m.index! + "Promise.all".length);
    if (/\btx\b/.test(stripOwnTx(body))) hits.push(src.slice(0, m.index!).split("\n").length);
  }
  return hits;
}

test("pemindai: mendeteksi Promise.all pada tx dan mengizinkan transaksi sendiri-sendiri", () => {
  assert.deepEqual(findTxPromiseAll("const a = await Promise.all([q1(tx), q2(tx)]);"), [1]);
  assert.deepEqual(findTxPromiseAll("x;\nconst b = await Promise.all([tx.select().from(t), other()]);"), [2]);
  assert.deepEqual(findTxPromiseAll("const [c, s] = await Promise.all([tenantQuery((tx) => list(tx, { q })), getSkillFieldOptions()]);"), []);
  assert.deepEqual(findTxPromiseAll("await Promise.all([withTenant(ctx, async (tx) => a(tx)), withSystem(async (tx) => b(tx))]);"), []);
  assert.deepEqual(findTxPromiseAll("await Promise.all([getLocale(), getSkillFields()]);"), []);
});

test("tidak ada Promise.all pada tx di src/ (pakai inSeries dari src/db/serial.ts)", () => {
  const offenders: string[] = [];
  for (const f of files(ROOT)) {
    if (f.endsWith("serial.ts")) continue; // komentar penjelasan
    const src = readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, ""); // abaikan komentar baris
    for (const line of findTxPromiseAll(src)) offenders.push(`${f.slice(ROOT.length - 3)}:${line}`);
  }
  assert.deepEqual(offenders, [], `Promise.all pada tx (kueri bersamaan pada satu koneksi). Pakai inSeries:\n${offenders.join("\n")}`);
});
