// Penjaga e2e (T-013): hentikan server bila pg memberi peringatan "Calling client.query() when the client is already executing a query".
// Peringatan itu berarti dua kueri dijalankan BERSAMAAN di satu koneksi/transaksi (biasanya Promise.all di dalam withTenant(tx => ...)); di pg@9 menjadi error.
// Dipasang lewat NODE_OPTIONS=--require oleh scripts/serve-standalone.mjs (dipakai tes e2e dan CI). Server mati dengan kode 97 dan e2e gagal keras;
// perbaikannya: kueri berurutan (`inSeries` di src/db/serial.ts), bukan Promise.all pada `tx`.
process.on("warning", (w) => {
  if (/already executing a query/.test(String(w && w.message))) {
    console.error(`\n✗ PG-GUARD: kueri bersamaan pada satu koneksi pg terdeteksi. Gunakan inSeries (src/db/serial.ts) alih-alih Promise.all pada tx.\n${w.stack || w.message}\n`);
    process.exit(97);
  }
});
