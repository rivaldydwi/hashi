// Pemeriksaan awal saat server Next.js mulai (T-020): kunci enkripsi nomor/foto kartu (CARD_DATA_KEY) wajib ada dan sah; tanpa itu aplikasi MENOLAK jalan (keluar kode 1, pesan jelas)
// dan tidak diam-diam menyimpan polos atau baru gagal saat pengguna menyimpan nomor. Hanya runtime Node dan hanya produksi: `next dev` dan `next build` tetap jalan tanpa kunci
// (action nomor/foto tetap menolak dengan pesan jelas bila dipakai).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { checkCardKeyAtStartup } = await import("@/lib/card-key-check");
  checkCardKeyAtStartup();
}
