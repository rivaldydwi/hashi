# Laporan engineer

Ditulis oleh **engineer** (Claude Code di Mini PC). PM membaca berkas ini saat me-review PR. **Entri terbaru di paling atas.**
Tidak boleh memuat secret, kata sandi, URL berkata sandi, isi `.env`, atau data pribadi kandidat.

## Format entri

```markdown
## YYYY-MM-DD · T-XXX · <judul singkat>

**PR:** #<nomor> (branch `eng/T-XXX-…`)
**Status:** siap direview | revisi ke-N | butuh Ipal | antrean kosong

**Yang dikerjakan**
- …

**Verifikasi** (perintah → hasil apa adanya; yang tidak dijalankan ditulis beserta alasannya)
- `npm run typecheck` → lulus
- …

**Kondisi server** (bila disentuh/di-deploy): commit produksi, health check.

**Kendala / catatan**
- …

**Pertanyaan** (awali `BUTUH IPAL:` bila harus diputuskan Ipal)
- …

**Usulan berikutnya** (bukan tugas; PM yang memutuskan masuk TASKS atau tidak)
- …
```

---

<!-- Entri baru di bawah garis ini, terbaru di atas. -->

## 2026-10-06 · T-003 · Cadangan lokal terjadwal (+ hasil deploy T-005)

**PR:** #5 (branch `eng/T-003-backup-terjadwal`)
**Status:** siap direview

**Hasil deploy T-005** (PR #4 di-merge `6a03395`, lalu deploy produksi sesuai arahan PM)
- Sebelum deploy: dump manual `~/hashi-backups/pre-t005-prod-<waktu>.dump` + `.sha256` (630 entri terbaca). Tanpa migrasi baru.
- `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` → `hashi-app-1` healthy.
- `curl -fsS http://127.0.0.1:3110/api/health` → `{"status":"ok","commit":"6a03395"}`; `docker image inspect hashi-app` label `org.opencontainers.image.revision` = `6a03395` (= `git rev-parse --short HEAD` di `main`).
- Demo TIDAK disentuh (`hashi-demo-*` tetap Up 3 jam, health `{"status":"ok"}` tanpa `commit` = masih image lama; ikut deploy berikutnya yang diizinkan Ipal).

**Yang dikerjakan (T-003)**
- **Jadwal: systemd USER timer** `hashi-backup.timer`, harian 02:00 JST, `Persistent=true`. Alasan: mengejar putaran yang terlewat saat PC mati (cron biasa tidak), unit tersimpan di repo (`scripts/systemd/`) dan bisa dipasang ulang, log juga masuk journal.
  Dipasang dengan `scripts/systemd/install.sh install` (idempoten; `status` dan `uninstall` tersedia). Hanya dua unit milik Hashi + berkas kunci; layanan/jadwal lain tidak disentuh.
- `scripts/backup-run.sh` (pembungkus): menjalankan `backup.sh` dengan `HASHI_BACKUP_KEEP=14`, log ke `~/hashi-backups/backup.log` (diputar ke `.log.1` bila > 1 MB), `LAST_FAILED` (waktu, kode, pesan) saat gagal dan dihapus saat berhasil.
- `scripts/decrypt.sh` (stdout saja) dan `docs/backup.md` §4b langkah 3-4 ditulis ulang dengan perintah lengkap (catatan PM soal `decrypt`).
- `docs/backup.md`: status (jadwal lokal aktif; luar-server ditunda, risiko disk rusak = cadangan hilang), cara pasang/copot/cek, batasan linger, retensi, §6 diperbarui.
- Kunci dibuat acak oleh `install.sh` langsung ke berkas (tidak pernah dicetak). Dump manual lama tidak dihapus.

**Verifikasi** (perintah → hasil apa adanya)
- `scripts/systemd/install.sh install` → timer aktif; `systemctl --user list-timers hashi-backup.timer` → **putaran berikutnya Rabu 2026-10-07 02:00 JST**.
- Dipicu manual `systemctl --user start hashi-backup.service` → exit 0, Result=success, set baru `hashi-20261006-133454-*` (database 630 entri, 146 berkas dokumen, 732 KB), log `BERHASIL`, tidak ada `LAST_FAILED`.
- Set hasil jadwal itu dipulihkan ke db-dev dengan `scripts/restore.sh` → **cocok dengan produksi**: 5 organisasi, 36 kandidat, 144 dokumen, 16 catatan kegiatan, 150 entri audit; 146 berkas dokumen. Database `hashi_restore_dev` dan folder uji dibuang.
  (Satu salah langkah saya: glob `hashi-*.sha256` sempat mengenai dump manual lama `hashi-prod-backup-…sql`; `restore.sh` menolaknya "berkas tidak ada", tidak ada yang berubah; diulang dengan pola nama yang tepat.)
- Simulasi gagal: `HASHI_BACKUP_PASSPHRASE= scripts/backup-run.sh` → exit 1, `LAST_FAILED` berisi waktu + kode 1 + pesan "HASHI_BACKUP_PASSPHRASE belum di-set", log `GAGAL`, tidak ada set parsial. Lalu `systemctl --user start hashi-backup.service` → berhasil, `LAST_FAILED` terhapus.
- Rotasi log diuji di folder sementara: log 1,2 MB → `backup.log.1` + log baru.
- `scripts/decrypt.sh`: db dimulai `PGDMP`, docs 146 berkas; kunci salah → exit 2.
- Repo: `git ls-files | grep -E '\.(gpg|dump)$|backup\.env'` → 0 baris; kunci tidak ada di repo/log/PR/STATUS.
- CI: lihat status PR (tidak ada perubahan kode aplikasi).

**Kondisi server:** produksi `6a03395` healthy (lihat atas). Perubahan di host: dua unit user systemd + symlink `timers.target.wants`, `~/.config/hashi/backup.env` (600, folder 700), `~/hashi-backups/backup.log` + set cadangan baru (2 set utuh: satu dari uji manual, satu dari uji pemulihan kegagalan).

**Info untuk Ipal**
- **Jenis jadwal:** systemd user timer; **putaran berikutnya: Rabu 2026-10-07 02:00 JST**, lalu tiap hari.
- **Lokasi kunci:** `/home/ipal/.config/hashi/backup.env` (berisi `HASHI_BACKUP_PASSPHRASE` dan `HASHI_BACKUP_KEEP`).
- **Cara menyalin kunci:** di terminal Ipal sendiri jalankan `cat ~/.config/hashi/backup.env`, salin baris `HASHI_BACKUP_PASSPHRASE=…` ke pengelola kata sandi, lalu cek bisa dibaca kembali dari sana. Jangan ditempel ke chat/tiket/repo.

**Kendala / catatan**
- `Linger=no` untuk `ipal`: timer user hanya hidup selama sesi login aktif (sesi desktop di Mini PC ini aktif). Bila direstart tanpa login, tidak ada cadangan sampai login (lalu `Persistent` mengejar).
- Pengaman Claude Code sempat menolak `rm` bervariabel di dalam skrip (T-002); semua `rm` di skrip baru memakai `${VAR:?}`.

**Pertanyaan**
- BUTUH IPAL: aktifkan `sudo loginctl enable-linger ipal` agar timer jalan tanpa login? Efek sampingnya: SEMUA layanan user (mis. `openclaw-gateway`) ikut hidup tanpa login. Belum dilakukan. Alternatif: tetap seperti sekarang (cadangan jalan selama ada sesi login).
- BUTUH IPAL: sudah menyalin kunci ke pengelola kata sandi? (Tidak bisa saya pastikan dari server.)

**Usulan berikutnya** (bukan tugas)
- Pemberitahuan bila `LAST_FAILED` ada (mis. tampil di dashboard super admin atau notifikasi), dan uji pemulihan bulanan terjadwal ke db-dev.

---

## 2026-10-06 · T-005 · Commit yang berjalan bisa dibaca langsung

**PR:** #4 (branch `eng/T-005-commit-terbaca`)
**Status:** siap direview (deploy produksi dilakukan SETELAH merge; hasilnya dicatat di bawah setelah itu)

**Yang dikerjakan**
- `Dockerfile`: `ARG GIT_SHA=unknown` (di akhir stage supaya cache layer tetap) → `LABEL org.opencontainers.image.revision` di stage `runner` DAN `tools`; stage `runner` juga `ENV GIT_SHA`.
- `compose.yaml`: `build.args.GIT_SHA: ${GIT_SHA:-unknown}` untuk `app` dan `migrate`. `scripts/demo-lib.sh` `dc()` mengisi `GIT_SHA` otomatis dari `git rev-parse --short HEAD` (jadi `dc up` demo ikut tanpa perubahan perintah).
- `/api/health` → `{"status":"ok","commit":"<sha pendek>"}` (`src/lib/build-info.ts`: hanya sha heksadesimal 7-40 karakter yang dipercaya, selain itu `unknown`; tidak ada info lain). Respons galat (503) tidak berubah.
- Label versi: `common.version` diganti dari "Hashi v0.2" menjadi "Hashi · {commit}" (id dan ja). **Catatan:** kunci lama itu TIDAK dirender di mana pun (kunci mati), jadi tidak ada "footer" yang diganti; saya menampilkannya sebagai teks kecil di bagian bawah sidebar (`data-testid="build-version"`, di bawah menu akun).
- Perintah deploy di README, `CLAUDE.md`, `docs/HISTORY.md` menjadi `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build`.
- CI (job `docker`): build `runner` dan `tools` dengan `GIT_SHA=${GITHUB_SHA::7}`, lalu periksa label = sha, env `GIT_SHA` di container = sha, dan build TANPA build-arg tetap berhasil dengan label dan env `unknown`.

**Verifikasi** (perintah → hasil apa adanya)
- `npm run typecheck` → lulus. `npm run test:i18n` → lulus (1299 kunci). `npm run test:unit` → lulus (tes baru `build-info`). `npm run build` → 0 peringatan.
- `E2E_PORT=3120 npx playwright test health ui-polish dashboard` → 20 lulus (tes baru: `/api/health` memuat tepat kunci `status` dan `commit`; sidebar menampilkan "Hashi · unknown|sha", bukan "v0.2"). e2e penuh tidak dijalankan lokal (hanya yang tersentuh); CI menjalankannya.
- Lokal: `docker build --target runner --build-arg GIT_SHA=c634f2b` → label `c634f2b`, env `c634f2b`. Tanpa arg → `unknown` dan `unknown` (build tidak gagal). Image uji itu sudah saya hapus (milik saya, `hashi-t005-test`).

**Kondisi server:** belum ada yang di-deploy (menunggu merge). Demo TIDAK disentuh (izin Ipal diperlukan); demo akan ikut sha saat deploy berikutnya yang memang direncanakan.

**Kendala / catatan**
- Tanpa `GIT_SHA` di perintah deploy, hasilnya `unknown` (disengaja, tidak gagal). Mudah lupa: usulan menjadikan deploy satu skrip (`scripts/deploy.sh` yang mengisi sha dan memeriksa `/api/health`).
- `.claude/settings.local.json` (izin `gh pr merge`) kini dikecualikan lewat `.git/info/exclude` lokal karena `.gitignore` repo tidak memuatnya (PM mengira diabaikan secara bawaan). Usulan: tambahkan `.claude/settings.local.json` ke `.gitignore` lewat PR kecil.

**Pertanyaan**
- Tidak ada yang butuh Ipal.

**Usulan berikutnya** (bukan tugas)
- `scripts/deploy.sh` (sha otomatis + health check + cetak commit yang berjalan).
- Tambah `.claude/settings.local.json` ke `.gitignore`.

---

## 2026-10-06 · T-002 · Cadangan di luar server: desain + skrip lokal

**PR:** #3 (branch `eng/T-002-backup-desain`)
**Status:** siap direview

**Yang dikerjakan**
- `docs/backup.md`: apa yang dicadangkan, frekuensi, retensi, enkripsi, restore langkah demi langkah (uji ke db-dev, dan runbook produksi manual), 3 pilihan tujuan luar-server + perkiraan biaya, rekomendasi.
- `scripts/backup.sh`: `pg_dump -Fc` produksi + tar volume `hashi_docs-data` (container sementara `alpine` yang sudah ada, `--pull=never --network none --read-only`, volume `:ro`) → `gpg` simetris AES256, SEMUA lewat pipa (tidak ada data tanpa enkripsi di disk);
  checksum SHA-256, manifest tanpa data pribadi, pembacaan ulang cadangan setelah ditulis, hanya menyentuh `hashi-db-1` dan `hashi_docs-data` (nama lain ditolak), retensi opsional yang hanya menghapus set bernama `hashi-<tanggal>-<jam>-*`.
- `scripts/restore.sh`: memulihkan KE db-dev saja (database wajib berakhiran `_dev`/`_test`, `hashi`/`hashi_demo`/`hashi_dev` ditolak), memeriksa checksum + kunci sebelum membuat apa pun, membersihkan sisa bila gagal.
- `.env.example`: nama `HASHI_BACKUP_PASSPHRASE`, `HASHI_BACKUP_DIR`, `HASHI_BACKUP_KEEP` (tanpa nilai); `.gitignore`: `*.gpg`, `*.dump`; README bagian backup merujuk ke `docs/backup.md`.
- Belum memasang cron/timer dan tidak mengirim apa pun ke luar server (T-003).

**Verifikasi** (perintah → hasil apa adanya; kunci uji = `openssl rand -hex 24` sekali pakai di folder sementara di luar repo, tidak disimpan di repo)
- `scripts/backup.sh` tanpa kunci → gagal, kode 1, pesan jelas. Kunci pendek → gagal. `HASHI_DB_CONTAINER=hashi-demo-db-1` → ditolak.
- `scripts/backup.sh` (produksi) → berhasil: database 630 entri `pg_restore --list`, 146 berkas dokumen, 732 KB total, berkas mode 600 di folder mode 700; ciphertext tidak memuat penanda `PGDMP`.
- Retensi: dua set tambahan dengan `HASHI_BACKUP_KEEP=2` + berkas `pre-manual-dump.dump` → hanya set tertua dihapus, berkas manual utuh.
- `scripts/restore.sh` ke nama `hashi`, `hashi_demo`, `hashi_dev` → ditolak. Kunci salah → gagal sebelum membuat database (db tersisa 0). Berkas diubah (checksum) → gagal.
  Pada percobaan pertama kunci salah sempat meninggalkan database kosong; diperbaiki dengan pemeriksaan header dump + pembersihan otomatis, lalu diuji ulang (db tersisa 0).
- Restore benar ke `hashi_restore_dev` (db-dev): 1,7 detik; hitungan sama dengan produksi: 5 organisasi, 36 kandidat, 144 dokumen, 16 catatan kegiatan; 146 berkas dokumen.
- Aplikasi (build standalone, port 3121) terhadap database dan dokumen hasil restore: login `tsk.admin` berhasil, halaman kandidat 200, unduh dokumen 200 `application/pdf` (magic `%PDF`), baris `document.download` tercatat di audit database restore.
  Sesudahnya app 3121 dimatikan, database `hashi_restore_dev` dan folder uji dihapus (semua milik uji ini; produksi, demo, `hashi_dev` tidak disentuh).
- Berkas cadangan di repo: `git ls-files | grep -E '\.(dump|gpg)$'` → kosong; `git check-ignore` mengonfirmasi `*.gpg` diabaikan. Pindai: kunci uji tidak ada di berkas repo.
- CI: lihat status PR (tidak ada perubahan kode aplikasi).

**Kondisi server:** tidak ada yang di-deploy. Produksi dibaca (pg_dump, volume `:ro`); satu-satunya perubahan di Mini PC adalah database/folder uji yang sudah dibuang. Cadangan uji ada di folder sementara di luar repo dan `~/hashi-backups` TIDAK diisi/diubah.

**Kendala / catatan**
- Pengaman Claude Code sempat menolak `rm` dengan variabel tak terlindungi di dalam skrip; ditulis ulang memakai `${VAR:?}` (lebih aman juga untuk skrip aslinya).
- Berkas dokumen di volume dimiliki uid 1000; `restore.sh` (db-dev) memakai `--no-same-owner`. Untuk produksi, langkah `chown -R 1000:1000` ada di `docs/backup.md` §4b.
- Harga di `docs/backup.md` §5 ditulis dari ingatan, ditandai belum diverifikasi.
- Merge PR #2 sempat ditolak pengaman otomatis ("merge tanpa review", karena PM dan engineer satu akun GitHub); Ipal lalu memilih memberi izin permanen `gh pr merge` untuk PR `[T-…]` yang sudah `PM: DISETUJUI` + CI hijau, dengan `.claude/settings.json` lokal (BELUM di-commit, bukan bagian PR ini; PM/Ipal yang menentukan perlu tidaknya masuk repo).

**Pertanyaan**
- BUTUH IPAL: pilih tujuan luar-server (A restic→B2 yang direkomendasikan, B rclone/penyimpanan lain, atau C disk eksternal) beserta akun, cara pembayaran, dan **tempat menyimpan `HASHI_BACKUP_PASSPHRASE`** di luar server. Tanpa ini T-003 tidak bisa jalan.
- BUTUH IPAL: setuju memasang `restic`/`rclone` dan jadwal (cron/systemd timer) di host untuk T-003?

**Usulan berikutnya** (bukan tugas)
- Peringatan bila cadangan gagal/terlambat (mis. ping ke layanan pemantau) dan uji pemulihan terjadwal bulanan ke db-dev.
- Cadangan `.env` terpisah (tanpa isi di repo) di pengelola kata sandi.

---

## 2026-10-06 · T-001 · Laporan kondisi Mini PC

**PR:** #2 (branch `eng/T-001-laporan-kondisi`)
**Status:** siap direview

**Yang dikerjakan**
- Hanya membaca kondisi server; tidak ada perubahan kode atau konfigurasi server. PR ini hanya mengubah `docs/STATUS.md`.

**Verifikasi** (perintah → hasil apa adanya)
- **Produksi:** `docker compose ps` → `hashi-app-1` (image `hashi-app`, port host 3110 → 3100) dan `hashi-db-1` (`postgres:16-alpine`) Up, healthy.
  `curl -fsS http://127.0.0.1:3110/api/health` → `{"status":"ok"}`.
- **Commit yang berjalan di produksi:** image `hashi-app` TIDAK menyimpan label commit (labelnya hanya label compose), jadi commit hanya bisa disimpulkan dari waktu build:
  `docker image inspect hashi-app --format '{{.Created}}'` → 2026-10-06 10:31 JST; commit terakhir yang mengubah kode, `c65cb2e`, dibuat 10:18 JST dan di-deploy setelah CI hijau.
  Jadi produksi = `c65cb2e`. `main` sekarang `b6b0d0a`; selisihnya hanya dokumen (`CLAUDE.md`, `README.md`, `docs/HISTORY.md`, `docs/STATUS.md`, `docs/TASKS.md`), tidak ada kode: **kode produksi setara dengan `main`**.
  (Image `hashi-migrate` bertanggal 10:14: layer tidak berubah karena hanya `src/db` yang masuk image itu.)
- **Demo:** `hashi-demo-app-1` dan `hashi-demo-db-1` Up, healthy; `curl -fsS http://127.0.0.1:3111/api/health` → `{"status":"ok"}`.
- **db-dev:** `hashi-db-dev-1` Up (2 jam), healthy, hanya di `127.0.0.1:5433`. `.env` lokal menunjuk database `hashi_dev` (DATABASE_URL dan MIGRATE_DATABASE_URL; hanya nama database yang dibaca).
- **Versi:** node v25.9.0, npm 11.12.1, Docker 29.8.2, Docker Compose v5.6.0. `gh auth status` → berhasil (akun `rivaldydwi`).
- **Playwright:** Chromium terpasang (`~/.cache/ms-playwright`: chromium-1243, chromium_headless_shell-1243, ffmpeg-1011), jadi `test:e2e` bisa dijalankan (terakhir lulus 156/156 pada 2026-10-06).
- **Disk:** `/` (nvme0n1p2, juga tempat Docker) 233G, terpakai 89G (41%), sisa 132G.
- **Volume `docs-data` produksi** (`hashi_docs-data`): 752K.
- **Cadangan otomatis:** tidak ada. `crontab -l`, `systemctl list-timers --all`, dan `/etc/cron.d` tidak memuat apa pun terkait Hashi. Yang ada hanya cadangan manual `pg_dump -Fc` + `.sha256` sebelum tiap rilis di `~/hashi-backups/` (21 berkas); terbaru `pre-6-prod-20261006-101417.dump` dan `pre-6-demo-20261006-101417.dump` (2026-10-06). **Tidak ada cadangan volume `docs-data`** dan tidak ada salinan di luar server.
- **`/loop` di Claude Code VS Code:** bisa. `/loop 1h …` berhasil membuat jadwal (job cron sesi, tiap jam menit :07, kedaluwarsa otomatis 7 hari, hilang bila sesi/VS Code ditutup). Catatan: `/loop` dengan interval ≥ 60 menit selalu menawarkan jadwal cloud dulu; untuk siklus ini dipilih "hanya sesi ini" karena engineer butuh akses Mini PC.

**Kondisi server:** tidak ada yang diubah atau di-deploy. Produksi di `c65cb2e`, healthy.

**Kendala / catatan**
- Untuk mengukur ukuran volume saya menjalankan satu container sementara (`docker run --rm -v hashi_docs-data:/d:ro alpine du -sh /d`): volume dipasang baca-saja, image `alpine` sudah ada di host (tidak ada yang diunduh), container langsung terhapus. Itu container di luar project compose `hashi` walau hanya sesaat; kalau PM menganggap itu melanggar "Batasan server", beri tahu dan saya hindari lain kali (alternatif: `docker exec hashi-app-1 du -sh <STORAGE_DIR>`).
- Versi Hashi di footer UI masih "Hashi v0.2" (`common.version`), tidak mengikuti tahap pengerjaan.

**Pertanyaan**
- Tidak ada yang butuh Ipal untuk tugas ini.

**Usulan berikutnya** (bukan tugas)
- Tambah label commit pada image saat build (mis. build-arg `GIT_SHA` ke `LABEL org.opencontainers.image.revision`) dan tampilkan di `/api/health`, supaya "commit apa yang berjalan" bisa dibaca langsung, bukan ditebak dari waktu build.
- Cadangan `docs-data` belum pernah dibuat sama sekali; T-002 sebaiknya mencakup volume itu sejak awal (sudah tercantum).
