// Kueri BERURUTAN pada satu transaksi (T-013). Satu transaksi = SATU koneksi pg; menjalankan beberapa kueri bersamaan di koneksi yang sama (Promise.all di dalam withTenant/tx)
// memicu peringatan "Calling client.query() when the client is already executing a query is deprecated" (di pg@9 menjadi error). JANGAN memakai Promise.all pada `tx`;
// pakai `inSeries(() => kueri1, () => kueri2)`. (Promise.all tetap boleh untuk pekerjaan yang TIDAK memakai koneksi yang sama, mis. getLocale() atau transaksi terpisah.)
// Dijaga `scripts/guard-pg-concurrency.cjs` (e2e gagal bila kueri bersamaan terjadi) dan `tests/unit/no-tx-promise-all.test.ts` (pemindai sumber).

type Thunk = () => PromiseLike<unknown>;

/** Jalankan fungsi-fungsi (yang mengembalikan kueri/janji) satu per satu, hasilnya berurutan seperti Promise.all. */
export async function inSeries<T extends readonly Thunk[]>(...fns: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const fn of fns) out.push(await fn());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
