import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTestDatabase } from "../../scripts/db-guard";
import { CARD_PLAN, PILOT_CANDIDATES, PILOT_ORG_COUNTS } from "../../src/db/demo-pilot";
import { addDays, cardStage } from "../../src/db/zairyu";

// seed:pilot (T-014): ditolak di database produksi; sebaran tahap kartu benar untuk SETIAP tanggal (tidak bergantung hari seed dijalankan).
test("seed:pilot ditolak bila database bukan _dev/_test/_demo (produksi 'hashi' ditolak), diterima di hashi_dev / hashi_test / hashi_demo", () => {
  const env = (name: string) => ({ DATABASE_URL: `postgresql://hashi_app:x@127.0.0.1:5432/${name}`, MIGRATE_DATABASE_URL: `postgresql://hashi_owner:x@127.0.0.1:5432/${name}` }) as unknown as NodeJS.ProcessEnv;
  assert.throws(() => assertTestDatabase("seed:pilot", "", env("hashi")), /DITOLAK/);
  assert.throws(() => assertTestDatabase("seed:pilot", "", { ...env("hashi_dev"), DATABASE_URL: "postgresql://hashi_app:x@127.0.0.1:5432/hashi" } as NodeJS.ProcessEnv), /DITOLAK/); // salah satu URL ke produksi sudah cukup
  for (const ok of ["hashi_dev", "hashi_test", "hashi_demo"]) assert.doesNotThrow(() => assertTestDatabase("seed:pilot", "", env(ok)));
});

test("jumlah kandidat pilot = 200 (90 + 70 + 40)", () => {
  assert.deepEqual([...PILOT_ORG_COUNTS], [90, 70, 40]);
  assert.equal(PILOT_CANDIDATES, 200);
});

test("rencana kartu pilot menghasilkan tahap yang dijanjikan untuk SETIAP hari selama 3 tahun (termasuk akhir bulan dan Februari)", () => {
  const bad: string[] = [];
  for (let d = 0; d < 366 * 3; d++) {
    const today = addDays("2026-01-01", d);
    for (const p of CARD_PLAN) {
      if (p.stage === "nodata") continue;
      const r = cardStage({ expiryDate: addDays(today, p.offset!), renewalStatus: p.status ?? "not_started", today });
      if (r.stage !== p.stage || r.additionalDocs !== Boolean(p.docsFlag) || (p.special && !r.specialUntil)) bad.push(`${today}/${p.label}->${r.stage}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} kegagalan`);
});

test("rencana kartu pilot memuat SEMUA tahap yang dijanjikan T-019", () => {
  const stages = new Set(CARD_PLAN.map((p) => p.stage));
  for (const s of ["prepare", "can_apply", "h30", "h14", "h7", "expired", "waiting_result", "special_overdue", "rejected", "none", "nodata"]) assert.ok(stages.has(s as never), s);
  assert.ok(CARD_PLAN.some((p) => p.docsFlag), "ada 追加資料");
  assert.ok(CARD_PLAN.some((p) => p.special), "ada 特例期間");
});
