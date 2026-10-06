# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (setelah review T-001).

---

## Antrean

### T-002 · Cadangan di luar server: desain + skrip lokal · `SIAP`

Latar: catatan kegiatan disimpan 5 tahun dan tidak bisa dihapus lewat aplikasi; cadangan luar-server **wajib** sebelum data nyata masuk.
Tugas ini HANYA desain + skrip yang menulis cadangan terenkripsi ke disk lokal + uji restore ke db-dev. Pengiriman ke luar server
(layanan/akun/biaya) diputuskan Ipal setelah melihat usulan ini (lihat T-003).

Kerjakan:
- `docs/backup.md`: apa yang dicadangkan (database `hashi` lewat `pg_dump -Fc`, volume `docs-data`; database dan volume demo TIDAK perlu),
  frekuensi, retensi, enkripsi, cara restore langkah demi langkah, dan **2-3 pilihan tujuan luar-server** (mis. restic/rclone ke penyimpanan
  awan, disk eksternal di lokasi lain) dengan perkiraan biaya bulanan untuk ukuran data sekarang. Rekomendasikan satu.
- `scripts/backup.sh` (dan bila perlu `scripts/restore.sh`): hanya menyentuh project compose `hashi`; tidak memakai `docker system prune` /
  `volume rm`; kunci/kata sandi enkripsi dibaca dari variabel lingkungan (nama variabelnya ditambahkan ke `.env.example` TANPA nilai); gagal
  dengan kode keluar bukan 0 dan pesan jelas; menulis checksum.
- Uji restore: cadangan produksi di-restore ke **db-dev** (database berakhiran `_dev`) + folder dokumen sementara; aplikasi dev bisa login dan
  membuka satu dokumen kandidat. Tulis langkah dan hasilnya di STATUS.
- Membaca volume `hashi_docs-data` lewat container sementara (`docker run --rm -v hashi_docs-data:/d:ro …`, image yang sudah ada di host) BOLEH untuk
  cadangan: baca-saja, langsung terhapus, tidak menyentuh layanan lain. Cadangan manual lama di `~/hashi-backups/` jangan dihapus; usulkan retensinya di `docs/backup.md`.
- **Belum** memasang cron/systemd timer (itu menyentuh host; masuk T-003 setelah Ipal setuju).

**Kriteria selesai**
- [ ] `docs/backup.md` lengkap dengan rekomendasi tujuan luar-server + perkiraan biaya.
- [ ] Skrip berjalan di Mini PC, menghasilkan berkas terenkripsi + checksum; berkas cadangan TIDAK ada di repo (cek `.gitignore`).
- [ ] Uji restore ke db-dev berhasil dan didokumentasikan (perintah + hasil).
- [ ] README bagian backup merujuk ke `docs/backup.md`.
- [ ] CI hijau.

---

### T-005 · Commit yang berjalan bisa dibaca langsung · `SIAP`

Dari usulan T-001: saat ini commit produksi hanya bisa ditebak dari waktu build image.

Kerjakan:
- Build image menerima build-arg `GIT_SHA` (bawaan `unknown`) dan menulisnya ke `LABEL org.opencontainers.image.revision` serta env aplikasi.
  `compose.yaml` meneruskannya (mis. `GIT_SHA: ${GIT_SHA:-unknown}`); perintah deploy di README/CLAUDE.md menjadi
  `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` (berlaku juga untuk `dc up` demo di `scripts/demo-lib.sh`).
- `/api/health` mengembalikan `{"status":"ok","commit":"<sha pendek>"}`. Tidak ada informasi lain (tanpa versi paket, env, atau nama host).
- Footer UI: ganti `common.version` "Hashi v0.2" menjadi versi yang tidak basi (mis. "Hashi" + sha pendek), id dan ja.
- Job `docker` di CI: build dengan `GIT_SHA` dan periksa label image berisi sha tersebut.

**Kriteria selesai**
- [ ] `docker image inspect` menunjukkan label revision = commit yang dibangun; `/api/health` memuat `commit`.
- [ ] Tanpa `GIT_SHA`, build tetap berhasil (`unknown`), tidak gagal.
- [ ] Deploy dilakukan setelah merge, dan STATUS mencatat output `/api/health` produksi beserta commit-nya.
- [ ] typecheck, test:i18n, build, CI hijau.

---

### T-003 · Cadangan luar-server: pasang jadwal dan tujuan · `DITAHAN`

Menunggu Ipal memilih tujuan dari usulan T-002 (akun, biaya, kunci enkripsi disimpan di mana). Rincian dan kriteria ditulis PM setelah itu.

---

### T-004 · Pelacak zairyū kādo (在留カード): desain · `DITAHAN`

Menunggu T-002 selesai. Bentuknya: dokumen desain dulu (`docs/zairyu-card.md`), BELUM kode: tabel + RLS (hanya TSK), kolom yang disimpan (tanggal
habis, status perpanjangan, tanggal pengajuan ke 入管, tanggal terima kartu baru; nomor kartu perlu tidaknya dipertanyakan), penanggung jawab (担当)
per pekerja, jadwal pengingat dari `CLAUDE.md` (persiapan H-4 bulan, pengajuan mulai H-3 bulan, H-30/H-14/H-7, lewat; berhenti saat kartu baru
diterima), tampilan dashboard, dan daftar pertanyaan untuk staf TSK. Rincian ditulis PM saat dibuka.

---

## Cadangan (belum diurutkan; PM yang memindahkan ke antrean)

- Pelacak 在留カード: implementasi (setelah desain T-004 disetujui).
- Langkah 8 siap pilot: seed 200 siswa dummy, cek kecepatan halaman daftar/detail, `SHOW_DEMO_ACCOUNTS=false`, daftar periksa sebelum data nyata.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Telusuri peringatan `pg` "client.query() ... already executing" di log e2e (lihat `docs/HISTORY.md` §4).
- Langkah 9: demo ke TSK.

## Selesai

- **T-001** Laporan kondisi Mini PC (PR #2). Hasil penting: produksi sehat dan kodenya setara `main`; **belum ada cadangan otomatis maupun cadangan
  `docs-data`** (prioritas T-002); `/loop` jalan di VS Code. Pengukuran volume lewat container `alpine` sementara (baca-saja) diterima,
  tapi lain kali pakai `docker exec` ke container `hashi` yang sudah ada.

---

## Cara engineer berjalan otomatis (catatan untuk Ipal)

Engineer hanya bekerja saat sesinya hidup. Supaya Ipal tidak perlu mengetik apa-apa setiap ada tugas, buka sesi Claude Code di VS Code
di folder repo ini sekali, lalu ketik:

```
/loop 1h Jalankan satu putaran siklus engineer sesuai CLAUDE.md bagian "Peran dan aturan kerja".
```

VS Code dan Mini PC harus tetap menyala. PM memeriksa repo secara berkala dari sisi cloud.
