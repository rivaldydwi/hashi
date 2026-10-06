# Cadangan Hashi (T-002: desain + skrip lokal)

> **Status (T-003, 2026-10-06):** **jadwal lokal AKTIF**: systemd user timer `hashi-backup.timer`, harian pukul 02:00 JST (`Persistent=true`), menjalankan `scripts/backup.sh` lewat `scripts/backup-run.sh` dengan `HASHI_BACKUP_KEEP=14`.
> **Salinan di luar server DITUNDA** atas keputusan Ipal (sampai proyek siap dipakai sungguhan). **Risikonya: disk Mini PC rusak/hilang = cadangan ikut hilang.** Selama itu **jangan memasukkan data nyata**:
> catatan kegiatan disimpan 5 tahun dan tidak bisa dihapus lewat aplikasi, jadi kehilangan disk = kehilangan seluruh riwayat. Lapisan lokal ini melindungi dari salah hapus, migrasi buruk, dan kerusakan data logis, bukan dari kerusakan perangkat keras.

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

## 3. Cadangan terjadwal (systemd user timer) dan menjalankan manual

**Pasang / cek / copot** (hanya menyentuh dua unit milik Hashi dan berkas kuncinya; layanan dan jadwal lain tidak disentuh):

```bash
scripts/systemd/install.sh install     # membuat kunci bila belum ada, memasang unit, mengaktifkan timer
scripts/systemd/install.sh status      # kapan putaran berikutnya + status terakhir
scripts/systemd/install.sh uninstall   # mencopot timer dan unit; kunci dan cadangan TIDAK dihapus
systemctl --user start hashi-backup.service   # picu sekarang (uji / cadangan manual dengan kunci yang sama)
```

- **Mengapa systemd user timer, bukan cron:** `Persistent=true` menjalankan putaran yang terlewat (PC mati pukul 02:00) begitu timer aktif lagi, cron biasa melewatinya; unit-nya ada di repo (`scripts/systemd/`) sehingga bisa dipasang ulang; log masuk ke journal juga.
- **Batasan:** `loginctl show-user ipal -p Linger` = `no`, jadi timer user hanya hidup selama sesi login `ipal` aktif (di Mini PC ini sesi desktop selalu aktif). Bila Mini PC direstart dan tidak ada yang login, tidak ada cadangan sampai login
  (lalu `Persistent` mengejar yang terlewat). Mengaktifkan `sudo loginctl enable-linger ipal` menghilangkan batasan ini TETAPI membuat SEMUA layanan user (mis. `openclaw-gateway`) ikut jalan tanpa login: keputusan Ipal, belum dilakukan.
- **Kunci:** `~/.config/hashi/backup.env` (folder 700, berkas 600) berisi `HASHI_BACKUP_PASSPHRASE` dan `HASHI_BACKUP_KEEP=14`. Dibuat acak oleh `install.sh` dan tidak pernah dicetak. **Salin ke pengelola kata sandi (di luar server)**:
  buka berkas itu di terminal Ipal sendiri (`cat ~/.config/hashi/backup.env`), salin baris `HASHI_BACKUP_PASSPHRASE=…` ke pengelola kata sandi, lalu pastikan bisa dibaca kembali dari sana. Jangan menempelkannya ke chat, tiket, atau repo. Menghapus berkas ini tanpa salinan = cadangan lama tidak terbuka lagi.
- **Log dan kegagalan:** `~/hashi-backups/backup.log` (diputar ke `backup.log.1` bila > 1 MB). Bila putaran gagal, `~/hashi-backups/LAST_FAILED` berisi waktu, kode keluar, dan pesan; berkas itu dihapus oleh putaran berikutnya yang berhasil.
  **Periksa `ls ~/hashi-backups/LAST_FAILED` secara berkala**: pemberitahuan keluar (email/LINE) belum ada. `systemctl --user status hashi-backup.service` juga menunjukkan hasil terakhir.
- **Peringatan: skrip dijalankan dari working tree repo** (`<repo>/scripts/backup-run.sh` → `backup.sh`), bukan dari salinan terpasang. Bila pukul 02:00 engineer sedang berada di branch fitur, versi skrip DI BRANCH ITULAH yang jalan
  (dan bila working tree sedang berubah/rusak, cadangan bisa gagal). Biasakan kembali ke `main` setelah bekerja; kegagalan akan tampak sebagai `LAST_FAILED`.
- **Retensi:** 14 set terbaru bernama `hashi-<tanggal>-<jam>-*` dipertahankan; dump manual lama (`pre-*`, `hashi-prod-backup-*`) tidak pernah disentuh.

**Menjalankan manual** (tanpa timer):

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
3. Database: pulihkan ke database kosong. Kunci dimuat dulu (`set -a; . ~/.config/hashi/backup.env; set +a`, atau dari pengelola kata sandi), lalu:
   ```bash
   docker exec hashi-db-1 psql -U hashi_owner -d postgres -c 'drop database hashi with (force)'
   docker exec hashi-db-1 psql -U hashi_owner -d postgres -c 'create database hashi owner hashi_owner'
   scripts/decrypt.sh ~/hashi-backups/hashi-<ts>-db.dump.gpg | docker exec -i hashi-db-1 pg_restore -U hashi_owner -d hashi --exit-on-error
   ```
   (`scripts/decrypt.sh` hanya menulis ke stdout; setara dengan `gpg --decrypt` memakai kunci dari `HASHI_BACKUP_PASSPHRASE`. Role `hashi_owner`/`hashi_app` sudah ada; kepemilikan dan hak ikut dalam dump, tetapi
   **kata sandi role tidak ikut dump**: tetap dari `.env`.)
4. Dokumen: `scripts/decrypt.sh ~/hashi-backups/hashi-<ts>-docs.tar.gpg | docker run --rm -i --pull=never -v hashi_docs-data:/d alpine sh -c 'tar -xf - -C /d && chown -R 1000:1000 /d'`
   (volume ditulis sebagai root lalu diserahkan ke uid 1000, pemilik file di image aplikasi; lihat README bagian "Dokumen kandidat dan backup").
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

## 6. Yang BELUM ada

- **Salinan di luar server** (keputusan Ipal: ditunda; tetap WAJIB sebelum data nyata masuk). Pilihan dan rekomendasi di §5.
- Pemberitahuan keluar bila cadangan gagal/terlambat (sekarang hanya `LAST_FAILED` dan journal).
- Linger (agar timer jalan tanpa sesi login): lihat batasan di §3.
- Pengujian pemulihan penuh dari mesin lain, hanya dengan kunci dari pengelola kata sandi.
