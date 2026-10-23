// Tanggal seed (T-037): `SEED_TODAY=YYYY-MM-DD` menjalankan `db:seed` dan `verify:seed` SEOLAH-OLAH hari itu, untuk menguji seed di tanggal lain
// (`scripts/verify-seed-dates.sh`, HANYA database dev/test: pemanggil wajib `assertTestDatabase`). Tanpa variabel itu tidak ada yang berubah.
//
// Kenapa jam PROSES yang digeser (bukan parameter `today` saja): seed dan fungsi kueri aplikasi yang dipakai verify:seed (KPI, filter "paspor < 6 bulan",
// kuartal berjalan, ...) menghitung dari "sekarang" di banyak tempat; parameter saja akan membuat seed dan pemeriksaannya memakai tanggal berbeda.
// Jam database TIDAK digeser, jadi tanggal masa depan ditolak (trigger menolak tanggal di masa depan menurut jam database). Jaminan untuk tanggal
// mendatang datang dari tes unit fungsi murni (`demo-interviews`, `demo-data`), bukan dari skrip ini.
import { todayInTskTz } from "./time";

export class SeedDateError extends Error {}

/** Validasi nilai SEED_TODAY: null bila kosong; galat bila formatnya salah, tanggalnya tidak ada, atau di masa depan (tanggal Tokyo). */
export function parseSeedToday(raw: string | undefined, realToday: string): string | null {
  const v = raw?.trim() ?? "";
  if (v === "") return null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!valid) throw new SeedDateError(`SEED_TODAY tidak sah: "${v}" (format YYYY-MM-DD, tanggal yang ada)`);
  if (v > realToday) throw new SeedDateError(`SEED_TODAY ${v} ada di masa depan (hari ini ${realToday}, zona Tokyo): database menolak tanggal di masa depan`);
  return v;
}

/** Selisih (ms, kelipatan hari) dari hari ini ke tanggal seed. */
export const seedClockShiftMs = (seedToday: string, realToday: string) => Date.parse(`${seedToday}T00:00:00Z`) - Date.parse(`${realToday}T00:00:00Z`);

/** Pasang SEED_TODAY untuk proses ini: geser `Date` sejumlah hari utuh (jam tetap). Mengembalikan tanggal seed, atau null bila tidak diset. */
export function applySeedToday(env: NodeJS.ProcessEnv = process.env): string | null {
  const real = todayInTskTz();
  const day = parseSeedToday(env.SEED_TODAY, real);
  if (!day) return null;
  const shift = seedClockShiftMs(day, real);
  if (shift === 0) return day;
  const Real = Date;
  class SeedDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(Real.now() + shift);
      else super(...(args as [string | number | Date]));
    }
    static now() {
      return Real.now() + shift;
    }
  }
  globalThis.Date = SeedDate as DateConstructor;
  return day;
}

/** Tanggal bawaan `verify-seed-dates.sh`: awal dan akhir setiap kuartal fiskal dalam 12 bulan terakhir, ditambah hari ini (urut, tanpa ganda). */
export function defaultSeedCheckDates(realToday: string): string[] {
  const from = new Date(Date.parse(`${realToday}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const out = new Set<string>([realToday]);
  const startYear = Number(from.slice(0, 4));
  for (let y = startYear; y <= Number(realToday.slice(0, 4)); y++) {
    for (const [s, e] of [["01-01", "03-31"], ["04-01", "06-30"], ["07-01", "09-30"], ["10-01", "12-31"]]) {
      for (const d of [`${y}-${s}`, `${y}-${e}`]) if (d > from && d <= realToday) out.add(d);
    }
  }
  return [...out].sort();
}
