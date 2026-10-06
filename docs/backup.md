# Cadangan Hashi (T-002: desain + skrip lokal)

> **Status:** skrip lokal sudah ada dan teruji (`scripts/backup.sh`, `scripts/restore.sh`). **Belum ada jadwal otomatis dan belum ada salinan di luar server**:
> keduanya T-003 dan menunggu keputusan Ipal (akun, biaya, tempat menyimpan kunci). Selama itu belum jalan, **jangan memasukkan data nyata**.
> Catatan kegiatan disimpan 5 tahun dan tidak bisa dihapus lewat aplikasi; kehilangan disk Mini PC = kehilangan seluruh riwayat.

## 1. Apa yang dicadangkan

| Data | Sumber | Cara | Perlu? |
|---|---|---|---|
| Database produksi `hashi` (semua tabel, termasuk audit, catatan kegiatan, riwayat edit) | container `hashi-db-1` | `pg_dump -Fc` (format kustom, terkompresi, bisa dipulihkan per tabel) | **Wajib** |
| Dokumen dan lampiran (`<org>/<kandidat>/<id>.<ext>`, `activity/…`) | volume `hashi_docs-data` | `tar` lewat container sementara baca-saja | **Wajib** (metadata dokumen ada di database; satu tanpa yang lain tidak cukup) |
| Database dan volume demo (`hashi-demo`), db-dev | | | Tidak: data dummy, bisa dibuat ulang lewat seed |
| `.env` (kata sandi database, `AUTH_SECRET`) | | **Tidak masuk cadangan ini**; simpan terpisah di pengelola kata sandi | Wajib disimpan di tempat lain |
| Kode | GitHub | | Sudah ada |

Ukuran sekarang (2026-10-06, data dummy): database 11 MB di disk (dump terenkripsi ±350 KB), dokumen ±750 KB (±390 KB), jadi satu set ≈ **0,7 MB**.
Proyeksi data nyata (pilot 200 siswa, ±10 dokumen/siswa @ 1 MB + foto catatan kegiatan): **±3 GB dokumen + ±50 MB database** pada tahun pertama.

## 2. Frekuensi, retensi, enkripsi

- **Frekuensi (usulan):** harian pukul 02:00 JST (sepi), ditambah satu cadangan manual tepat sebelum tiap deploy yang memigrasi database. Target pemulihan: kehilangan maksimal 24 jam data (RPO), pulih < 1 jam (RTO).
- **Lapisan lokal** (`scripts/backup.sh`, folder `~/hashi-backups`, mode 700): simpan 14 set terakhir (`HASHI_BACKUP_KEEP=14`). Melindungi dari salah hapus/migrasi buruk, **bukan dari kerusakan disk** (disk sama dengan produksi).
- **Lapisan luar-server** (T-003): 30 harian + 12 bulanan + **5 tahunan** (sesuai masa simpan catatan 5 tahun). Pembersihan otomatis lewat kebijakan alat yang dipilih.
- **Cadangan manual lama** (`~/hashi-backups/pre-*-*.dump`, sekarang 21 berkas): tidak dihapus skrip. Usulan: simpan 5 deploy terakhir dan hapus yang lebih tua dari 90 hari, dilakukan Ipal/PM secara sadar (bukan otomatis).
- **Enkripsi:** `gpg --symmetric --cipher-algo AES256` (berintegritas: berkas yang dirusak gagal dibuka). Data TIDAK pernah ditulis ke disk tanpa enkripsi (pipa langsung). Kunci = `HASHI_BACKUP_PASSPHRASE` (≥ 16 karakter,
  acak, mis. `openssl rand -hex 24`).
  **Kunci wajib disimpan di luar server** (pengelola kata sandi + salinan tercetak di tempat aman). Tanpa kunci, cadangan tidak bisa dibuka; kunci yang hanya ada di Mini PC hilang bersama Mini PC.
- **Checksum:** `hashi-<tanggal>.sha256` (SHA-256 berkas terenkripsi). Skrip memeriksanya sendiri sesudah menulis; `restore.sh` memeriksanya sebelum memulihkan.
- **Uji pemulihan rutin:** tiap bulan jalankan `restore.sh` ke db-dev (bagian 4) dan catat hasilnya. Cadangan yang tidak pernah diuji dianggap belum ada.

## 3. Menjalankan cadangan

```bash
export HASHI_BACKUP_PASSPHRASE='...'      # dari pengelola kata sandi; JANGAN ditulis di repo atau riwayat shell bersama
HASHI_BACKUP_KEEP=14 scripts/backup.sh
```

Hasil: `~/hashi-backups/hashi-YYYYmmdd-HHMMSS-{db.dump.gpg,docs.tar.gpg,sha256,manifest}`. Manifest berisi hitungan (entri dump, jumlah berkas) dan commit kode, **tanpa data pribadi**.
Skrip: hanya menyentuh `hashi-db-1` dan volume `hashi_docs-data` (nama lain ditolak, jadi demo/db-dev tidak mungkin tersentuh); container sementara memakai image yang SUDAH ada (`--pull=never`), baca-saja, tanpa jaringan, langsung terhapus;
tidak memakai `docker system prune`/`volume rm`; setelah menulis, cadangan didekripsi lewat pipa dan dibaca (`pg_restore --list` harus > 100 entri, daftar isi tar terbaca). Gagal di langkah mana pun → berkas set itu dihapus, pesan jelas di stderr, kode keluar ≠ 0
(sudah diuji: tanpa kunci, kunci pendek, container demo).

Variabel (`.env.example` memuat NAMA-nya tanpa nilai): `HASHI_BACKUP_PASSPHRASE` (wajib), `HASHI_BACKUP_DIR`, `HASHI_BACKUP_KEEP`.

## 4. Memulihkan

### 4a. Uji pemulihan ke db-dev (aman, dilakukan rutin)

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev
HASHI_BACKUP_PASSPHRASE='...' scripts/restore.sh ~/hashi-backups/hashi-20261006-120110 --docs-dir ~/hashi-restore-test/docs
```

Hasil: database baru `hashi_restore_dev` di db-dev (nama WAJIB berakhiran `_dev`/`_test`; `hashi`, `hashi_demo`, `hashi_dev` ditolak) + dokumen di folder tujuan. Jalankan `npm run dev` / `scripts/serve-standalone.mjs`
dengan `DATABASE_URL` ke `hashi_restore_dev` dan `STORAGE_DIR` ke folder itu untuk memeriksa. Bila gagal di tengah (kunci salah, checksum tidak cocok, dump rusak), skrip membuang database/folder yang dibuatnya.
Bersihkan setelah uji: `docker exec hashi-db-dev-1 psql -U hashi_owner -d postgres -c 'drop database "hashi_restore_dev" with (force)'` dan hapus folder uji.

### 4b. Memulihkan PRODUKSI (manual, hanya dengan izin Ipal; `BUTUH IPAL`)

Skrip tidak mau memulihkan ke produksi, dengan sengaja. Langkah (urut):
1. Ipal memutuskan dan menyetujui. Buat cadangan keadaan SEKARANG dulu (`scripts/backup.sh`) walaupun rusak, supaya tidak ada yang hilang lagi.
2. `docker compose stop app` (database dan volume tetap).
3. Database: pulihkan ke database kosong. Mis. `psql -d postgres -c 'drop database hashi with (force)'`, `create database hashi owner hashi_owner`, lalu
   `decrypt hashi-<ts>-db.dump.gpg | docker exec -i hashi-db-1 pg_restore -U hashi_owner -d hashi --exit-on-error` (role `hashi_owner`/`hashi_app` sudah ada; kepemilikan dan hak ikut dalam dump, tetapi
   **kata sandi role tidak ikut dump**: tetap dari `.env`).
4. Dokumen: ekstrak ke volume dengan container sementara berjalan sebagai root, lalu `chown -R 1000:1000 /d` (pemilik file di image aplikasi = 1000; lihat README bagian "Dokumen kandidat dan backup").
5. `docker compose up -d` lalu cek `curl http://127.0.0.1:3110/api/health`, login, dan buka satu dokumen.
6. Catat di `docs/STATUS.md` apa yang dipulihkan, dari cadangan mana, dan berapa data yang hilang (selisih waktu).

## 5. Pilihan tujuan di luar server

Perkiraan harga **diambil dari ingatan, belum diverifikasi ke halaman harga resmi** (Ipal/PM perlu mengecek sebelum memutuskan). Dasar ukuran: ±3 GB di tahun pertama, ±10-15 GB dalam 5 tahun.

| # | Pilihan | Cara kerja | Perkiraan biaya/bulan | Catatan |
|---|---|---|---|---|
| A | **restic → Backblaze B2** (atau Cloudflare R2) | restic membaca sumber langsung, mengenkripsi di sisi klien, **inkremental + dedup**, kebijakan retensi bawaan (`forget --keep-daily 30 --keep-monthly 12 --keep-yearly 5`) | B2 ±US$0,006/GB → **< US$0,1** untuk ±10 GB (10 GB pertama biasanya gratis); R2 ±US$0,015/GB, tanpa biaya egress | Butuh memasang `restic` di host (T-003, izin Ipal) dan akun + kunci akses bucket. Dokumen tahunan kecil, jadi tumbuh pelan |
| B | **rclone/rsync berkas terenkripsi** buatan `backup.sh` ke penyimpanan awan (B2, Google Drive, dsb.) atau server lain (mis. Hetzner Storage Box ±€4/bulan flat 1 TB) | menyalin set `.gpg` apa adanya | sama seperti A, atau flat ±€4 | Paling sederhana dan tidak tergantung alat lain. **Kelemahan:** tiap set memuat semua dokumen (tidak inkremental): 14 set × 3 GB ≈ 42 GB. Perlu mengecilkan frekuensi dokumen (mis. dokumen mingguan, database harian) |
| C | **Disk eksternal di lokasi lain** (rumah/kantor Ipal), disalin lewat Tailscale (`rsync`) atau dibawa berkala | set `.gpg` disalin ke mesin/disk lain | ±Rp 700 rb-1 jt sekali beli (1 TB), tanpa biaya bulanan | Tidak ada akun awan; tapi butuh disiplin dan lokasi kedua yang menyala. Bagus sebagai lapisan TAMBAHAN |

**Rekomendasi: A (restic → Backblaze B2), ditambah lapisan lokal skrip ini.** Alasan: dokumen akan tumbuh dan harus disimpan 5 tahun; restic inkremental sehingga biayanya hampir nol dan jendela cadangan pendek,
enkripsi di sisi klien (penyedia tidak bisa membaca), retensi 5 tahunan jadi satu baris konfigurasi, dan restore per berkas mudah. Lapisan lokal `backup.sh` tetap berguna sebagai cadangan cepat dan untuk uji pemulihan.
Bila Ipal ingin menghindari akun awan, pilih C. Untuk A, pertanyaan untuk Ipal ada di STATUS (akun siapa, kartu pembayaran, tempat menyimpan kunci restic dan `HASHI_BACKUP_PASSPHRASE`).

## 6. Yang BELUM ada (T-003)

- Jadwal (cron/systemd timer) untuk `backup.sh` dan pengiriman ke luar server. Keduanya menyentuh host, jadi menunggu persetujuan Ipal.
- Pemberitahuan bila cadangan gagal (mis. ping ke layanan pemantau di Mini PC).
- Pengujian pemulihan penuh dari salinan luar-server (dari mesin lain, hanya dengan kunci dari pengelola kata sandi).
