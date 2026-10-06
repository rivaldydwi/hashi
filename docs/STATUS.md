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
