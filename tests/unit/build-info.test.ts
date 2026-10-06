import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCommit } from "../../src/lib/build-info";

test("normalizeCommit: hanya sha heksadesimal 7-40 karakter yang dipercaya; selain itu 'unknown'", () => {
  assert.equal(normalizeCommit("c634f2b"), "c634f2b");
  assert.equal(normalizeCommit("  C634F2B\n"), "c634f2b", "huruf besar dan spasi dirapikan");
  assert.equal(normalizeCommit("c634f2b9a1d3e5f7081726354433221100aabbcc"), "c634f2b9a1d3", "sha panjang dipotong 12 karakter");
  for (const bad of [undefined, null, "", "unknown", "abc12", "zzzzzzz", "c634f2b; rm -rf /", "<script>", "main"]) assert.equal(normalizeCommit(bad), "unknown", String(bad));
});
