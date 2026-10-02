import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Aturan privasi: data calon pekerja TIDAK BOLEH disimpan sebagai draf di peramban (localStorage/sessionStorage/IndexedDB).
// Pengecualian yang diizinkan hanya preferensi tampilan non-pribadi, dan harus didaftarkan di sini dengan alasan.
const ALLOWED: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test("kode aplikasi tidak memakai localStorage / sessionStorage / indexedDB", () => {
  const offenders = walk("src")
    .filter((f) => !ALLOWED.includes(f))
    .filter((f) => /\b(localStorage|sessionStorage|indexedDB)\s*[.[]/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
