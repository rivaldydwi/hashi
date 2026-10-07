import { CardKeyError, loadKeyring } from "./card-crypto";

/**
 * Pemeriksaan kunci enkripsi kartu saat server mulai (T-020). Kunci tidak sah: cetak pesan jelas (tanpa nilai kunci) lalu KELUAR dengan kode 1
 * (Next.js membiarkan proses hidup bila hook instrumentation hanya melempar galat, jadi container terlihat "jalan" padahal tidak melayani). `exit` bisa diganti untuk tes.
 */
export function checkCardKeyAtStartup(exit: (code: number) => void = (c) => process.exit(c)): void {
  try {
    loadKeyring();
  } catch (err) {
    const why = err instanceof CardKeyError ? err.message : "kunci tidak valid";
    console.error(`✗ Hashi tidak dijalankan: ${why}. Isi CARD_DATA_KEY di .env (lihat docs/backup.md, bagian 7 kunci data kartu).`);
    exit(1);
    throw err;
  }
}
