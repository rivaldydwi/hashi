// Pembangkit acak ber-seed tetap dan utilitas tanggal untuk data DEMO. Murni (tanpa impor) supaya aman di image tools.
import { createHash } from "node:crypto";

export type Rng = () => number;

/** mulberry32: PRNG kecil, hasilnya selalu sama untuk seed yang sama. */
export function makeRng(seed: string | number): Rng {
  let a = typeof seed === "number" ? seed >>> 0 : createHash("sha1").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
export const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
export const chance = (rng: Rng, p: number) => rng() < p;
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** UUID deterministik dari sebuah label (bentuk v4), supaya reseed menghasilkan id yang sama. */
export function uuidFor(label: string): string {
  const h = createHash("md5").update(`hashi-demo:${label}`).digest("hex").split("");
  h[12] = "4";
  h[16] = "89ab"[parseInt(h[16], 16) % 4];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// ---- Tanggal (YYYY-MM-DD, tanpa zona waktu: dihitung sebagai UTC) ----
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fmt(new Date(toDate(iso).getTime() + n * 86_400_000));
export function addMonths(iso: string, n: number) {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
}
export const addYears = (iso: string, n: number) => addMonths(iso, n * 12);
export const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
