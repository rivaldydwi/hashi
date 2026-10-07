import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Penjaga e2e T-013: peringatan pg "already executing a query" harus mematikan proses (kode 97); peringatan lain tidak.
const guard = new URL("../../scripts/guard-pg-concurrency.cjs", import.meta.url).pathname;
const run = (code: string) => spawnSync(process.execPath, ["--require", guard, "-e", code], { encoding: "utf8", timeout: 15000 });

test("penjaga: peringatan pg 'already executing a query' → proses mati kode 97 dengan pesan PG-GUARD", () => {
  const r = run(`process.emitWarning("Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.", "DeprecationWarning"); setTimeout(() => {}, 5000);`);
  assert.equal(r.status, 97, r.stderr);
  assert.match(r.stderr, /PG-GUARD/);
  assert.match(r.stderr, /inSeries/);
});

test("penjaga: peringatan lain tidak mematikan proses", () => {
  const r = run(`process.emitWarning("peringatan lain", "DeprecationWarning"); setTimeout(() => {}, 300);`);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /PG-GUARD/);
});

test("penjaga terpasang di serve-standalone (NODE_OPTIONS --require)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../scripts/serve-standalone.mjs", import.meta.url), "utf8");
  assert.match(src, /guard-pg-concurrency\.cjs/);
  assert.match(src, /NODE_OPTIONS: nodeOptions/);
});
