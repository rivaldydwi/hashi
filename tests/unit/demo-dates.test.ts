import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProfile, pilotBirthDate, seedBirthDate } from "../../src/db/demo-data";
import { PILOT_ORG_COUNTS, PIPELINE, STAGE_BY_MOD } from "../../src/db/demo-pilot";
import { addDays, addYears } from "../../src/db/demo-rng";
import { defaultSeedCheckDates, parseSeedToday, seedClockShiftMs, SeedDateError } from "../../src/db/seed-date";

// T-037: profil demo (seed dasar + pilot) masuk akal untuk SETIAP tanggal seed dua tahun fiskal. Tanggal lahir demo absolut, tanggal paspor relatif
// terhadap hari ini: dulu seed GAGAL ("paspor tidak masuk akal") untuk sebagian tanggal, mis. kandidat 1.2 pada 25 Jun - 27 Jul 2026.
const SEED_OFFSETS = [0, 5, 11]; // = OFFSETS di scripts/seed.ts
const FIRST = "2026-04-01";
const LAST = "2028-03-31";

function inputs(today: string) {
  const base = SEED_OFFSETS.flatMap((offset, orgIndex) =>
    Array.from({ length: 12 }, (_, i) => ({ orgIndex, i, stage: i < 4 ? "STUDYING" : i === 11 ? "WITHDRAWN" : "READY", birthDate: seedBirthDate(offset, i), variant: undefined as string | undefined })),
  );
  const pilot = PILOT_ORG_COUNTS.flatMap((n, orgIndex) =>
    Array.from({ length: n }, (_, k) => {
      const stage = STAGE_BY_MOD(k);
      return { orgIndex, i: PIPELINE[stage][k % PIPELINE[stage].length], stage, birthDate: pilotBirthDate(k), variant: `p${k}` };
    }),
  );
  return [...base, ...pilot].map((c) => ({ ...c, gender: "MALE" as const, fullName: "Adi Budi", firstName: "Adi", lastName: "Budi", fieldIndex: 0, today }));
}

test("buildProfile tidak pernah gagal dan paspornya masuk akal untuk setiap hari 1 Apr 2026 - 31 Mar 2028 (seed dasar + 200 pilot)", () => {
  const bad: string[] = [];
  let days = 0;
  for (let d = FIRST; d <= LAST; d = addDays(d, 1)) {
    days++;
    for (const c of inputs(d)) {
      try {
        const p = buildProfile(c as never);
        const { passportIssuedDate: issued, passportExpiryDate: expiry } = p.private;
        if (!(issued < d && issued >= addYears(c.birthDate, 15) && expiry > issued)) bad.push(`${d} ${c.orgIndex}.${c.i}${c.variant ?? ""}: terbit ${issued}, habis ${expiry}`);
      } catch (e) {
        bad.push(`${d} ${c.orgIndex}.${c.i}${c.variant ?? ""}: ${(e as Error).message}`);
      }
    }
  }
  assert.equal(days, 731);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} masalah`);
});

test("SEED_TODAY: kosong = tidak dipakai; format salah, tanggal yang tidak ada, atau masa depan ditolak dengan pesan jelas", () => {
  const real = "2026-10-23";
  assert.equal(parseSeedToday(undefined, real), null);
  assert.equal(parseSeedToday("  ", real), null);
  assert.equal(parseSeedToday("2026-07-01", real), "2026-07-01");
  assert.equal(parseSeedToday(" 2026-10-23 ", real), "2026-10-23");
  for (const bad of ["2026-7-1", "23-10-2026", "2026-02-30", "kemarin"]) assert.throws(() => parseSeedToday(bad, real), (e: Error) => e instanceof SeedDateError && /tidak sah/.test(e.message), bad);
  assert.throws(() => parseSeedToday("2026-10-24", real), (e: Error) => e instanceof SeedDateError && /masa depan/.test(e.message));
  assert.equal(seedClockShiftMs("2026-10-20", real), -3 * 86_400_000);
  assert.equal(seedClockShiftMs(real, real), 0);
});

test("tanggal bawaan verify-seed-dates: awal/akhir kuartal 12 bulan terakhir + hari ini", () => {
  assert.deepEqual(defaultSeedCheckDates("2026-10-23"), ["2025-12-31", "2026-01-01", "2026-03-31", "2026-04-01", "2026-06-30", "2026-07-01", "2026-09-30", "2026-10-01", "2026-10-23"]);
  assert.deepEqual(defaultSeedCheckDates("2026-04-01"), ["2025-06-30", "2025-07-01", "2025-09-30", "2025-10-01", "2025-12-31", "2026-01-01", "2026-03-31", "2026-04-01"]);
});
