import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { CardKeyError } from "../../src/lib/card-crypto";
import { checkCardKeyAtStartup } from "../../src/lib/card-key-check";
import { register } from "../../src/instrumentation";

// Aplikasi MENOLAK start di produksi tanpa kunci enkripsi kartu yang sah (T-020); dev/build tidak dihalangi; nilai kunci tidak dicetak.
function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  return fn().finally(() => { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); });
}

test("tanpa kunci / kunci rusak: pesan jelas tanpa nilai kunci, keluar kode 1, lalu melempar CardKeyError", async () => {
  const errors: string[] = [];
  const exits: number[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.join(" ")); };
  try {
    await withEnv({ CARD_DATA_KEY: undefined }, async () => {
      assert.throws(() => checkCardKeyAtStartup((c) => { exits.push(c); }), CardKeyError);
    });
    await withEnv({ CARD_DATA_KEY: "rahasia-pendek" }, async () => {
      assert.throws(() => checkCardKeyAtStartup((c) => { exits.push(c); }), CardKeyError);
    });
  } finally {
    console.error = orig;
  }
  assert.deepEqual(exits, [1, 1]);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => /CARD_DATA_KEY/.test(e)));
  assert.ok(errors.every((e) => !e.includes("rahasia-pendek")));
});

test("produksi dengan kunci sah lolos; dev/test dan runtime non-Node tidak diperiksa", async () => {
  const key = randomBytes(32).toString("base64");
  await withEnv({ CARD_DATA_KEY: key }, async () => { checkCardKeyAtStartup(() => assert.fail("tidak boleh keluar")); });
  await withEnv({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production", CARD_DATA_KEY: key }, () => register());
  await withEnv({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development", CARD_DATA_KEY: undefined }, () => register());
  await withEnv({ NEXT_RUNTIME: "edge", NODE_ENV: "production", CARD_DATA_KEY: undefined }, () => register());
});
