import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateCompleteness } from "../../src/db/completeness";
import { LIST_SECTIONS, SINGLE_SECTIONS } from "../../src/db/candidate-sections";

// Baris kandidat lengkap: semua kolom bagian satu-baris terisi (boolean = false tetap dianggap terisi)
function fullRows() {
  const candidate: Record<string, unknown> = {};
  const priv: Record<string, unknown> = {};
  for (const s of SINGLE_SECTIONS) for (const f of s.fields) (s.table === "candidates" ? candidate : priv)[f.name] = f.kind === "boolean" ? false : "x";
  return { candidate, priv };
}
const counts = { family: 1, education: 1, work: 1, certificates: 1 };

test("profil lengkap = 100 persen dan complete", () => {
  const { candidate, priv } = fullRows();
  const r = candidateCompleteness({ candidate, priv, counts });
  assert.equal(r.percent, 100);
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
});

test("kolom kosong atau spasi saja tidak dihitung; persentase dibulatkan ke bawah (99 bukan 100)", () => {
  const { candidate, priv } = fullRows();
  priv.whatsapp = "   ";
  const r = candidateCompleteness({ candidate, priv, counts });
  assert.equal(r.complete, false);
  assert.ok(r.percent < 100);
  assert.deepEqual(r.missing, ["contact.whatsapp"]);
});

test("catatan riwayat Jepang hanya dihitung bila pernah ke Jepang atau pernah ditolak visa", () => {
  const { candidate, priv } = fullRows();
  candidate.japanHistoryNote = null;
  candidate.everInJapan = false;
  candidate.visaRejectedBefore = false;
  assert.equal(candidateCompleteness({ candidate, priv, counts }).complete, true); // tidak berlaku
  candidate.everInJapan = true;
  const r = candidateCompleteness({ candidate, priv, counts });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["japan.japanHistoryNote"]);
  candidate.everInJapan = false;
  candidate.visaRejectedBefore = true;
  assert.equal(candidateCompleteness({ candidate, priv, counts }).complete, false);
});

test("bagian berbaris banyak (keluarga, pendidikan, kerja, sertifikat) butuh minimal satu baris", () => {
  const { candidate, priv } = fullRows();
  const r = candidateCompleteness({ candidate, priv, counts: { family: 0, education: 1, work: 0, certificates: 1 } });
  assert.deepEqual(r.missing, ["family", "work"]);
  assert.equal(r.total, SINGLE_SECTIONS.reduce((n, s) => n + s.fields.length, 0) - 1 + LIST_SECTIONS.length); // -1: catatan riwayat Jepang tidak berlaku
});

test("tanpa data sensitif (sensei): hanya bagian dasar yang dihitung", () => {
  const { candidate } = fullRows();
  const r = candidateCompleteness({ candidate, priv: null, counts: { family: 0, education: 0, work: 0, certificates: 0 }, includeSensitive: false });
  assert.equal(r.complete, true);
  const basic = SINGLE_SECTIONS.filter((s) => s.level === "basic").reduce((n, s) => n + s.fields.length, 0);
  assert.equal(r.total, basic);
});

test("data sensitif belum ada: kolom private dianggap kosong", () => {
  const { candidate } = fullRows();
  const r = candidateCompleteness({ candidate, priv: null, counts });
  assert.equal(r.complete, false);
  assert.ok(r.missing.some((m) => m.startsWith("contact.")) && r.missing.some((m) => m.startsWith("identity.")));
});
